/**
 * AWS WAF Challenge Solver
 *
 * Generic service for solving AWS WAF challenges using various providers.
 * Currently implements CapSolver but can be extended for other providers.
 */

import axios, { AxiosResponse } from 'axios';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import AlertService, { Severity, AlertCategory } from './AlertService';

export interface AwsWafChallengeData {
    awsKey?: string;
    awsIv?: string;
    awsContext?: string;
    awsChallengeJS?: string;
    awsProblemUrl?: string;
}

export interface WafChallengeSolverResult {
    success: boolean;
    cookie?: string;
    error?: string;
}

export interface WafChallengeSolverOptions {
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
}

/**
 * Generic interface for AWS WAF challenge solvers
 */
export interface IAwsWafChallengeSolver {
    detectChallenge(response: AxiosResponse): boolean;
    solveChallenge(
        websiteURL: string,
        htmlContent: string,
        options?: WafChallengeSolverOptions
    ): Promise<WafChallengeSolverResult>;
}

/**
 * CapSolver implementation of AWS WAF challenge solver
 */
class CapSolverProvider implements IAwsWafChallengeSolver {
    private static apiKey: string | null = null;
    private static readonly baseUrl = 'https://api.capsolver.com';
    private static readonly ssmClient = new SSMClient({
        region: process.env.AWS_REGION || 'us-east-2',
    });

    private static async getApiKey(): Promise<string> {
        if (this.apiKey) {
            return this.apiKey;
        }

        try {
            const parameterName =
                process.env.WAF_SOLVER_API_KEY_PARAMETER || '/zipcase/waf-solver/api-key';
            const command = new GetParameterCommand({
                Name: parameterName,
                WithDecryption: true,
            });

            const response = await this.ssmClient.send(command);
            if (!response.Parameter?.Value) {
                throw new Error('WAF solver API key not found in SSM Parameter Store');
            }

            this.apiKey = response.Parameter.Value;
            return this.apiKey;
        } catch (error) {
            await AlertService.logError(
                Severity.CRITICAL,
                AlertCategory.SYSTEM,
                'Failed to retrieve WAF solver API key from SSM',
                error as Error,
                { resource: 'waf-solver-api-key' }
            );
            throw error;
        }
    }

    detectChallenge(response: AxiosResponse): boolean {
        const html = response.data;
        const status = response.status;

        // Check for common AWS WAF challenge indicators
        return (
            status === 405 ||
            html.includes('window.gokuProps') ||
            html.includes('challenge.js') ||
            html.includes('captcha.js') ||
            html.includes('visualSolutionsRequired') ||
            html.includes('awswaf.com') ||
            html.includes('aws-waf-token')
        );
    }

    async solveChallenge(
        websiteURL: string,
        htmlContent: string,
        options: WafChallengeSolverOptions = {}
    ): Promise<WafChallengeSolverResult> {
        try {
            const apiKey = await CapSolverProvider.getApiKey();
            const challengeData = this.parseAwsWafChallenge(htmlContent);

            // Create task
            const createTaskPayload = {
                clientKey: apiKey,
                task: {
                    type: 'AntiAwsWafTaskProxyLess',
                    websiteURL,
                    ...challengeData,
                },
            };

            console.log('Creating WAF challenge solver task...');
            const createResponse = await axios.post(
                `${CapSolverProvider.baseUrl}/createTask`,
                createTaskPayload,
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000,
                }
            );

            if (createResponse.data.errorId !== 0 || !createResponse.data.taskId) {
                throw new Error(
                    `WAF solver task creation failed: ${createResponse.data.errorDescription || 'Unknown error'}`
                );
            }

            const taskId = createResponse.data.taskId;
            console.log(`WAF solver task created with ID: ${taskId}`);

            // Poll for result
            const cookie = await this.waitForTaskResult(taskId, apiKey, options);

            return {
                success: true,
                cookie: cookie || undefined,
            };
        } catch (error) {
            await AlertService.logError(
                Severity.ERROR,
                AlertCategory.PORTAL,
                'Failed to solve AWS WAF challenge',
                error as Error,
                { websiteURL, resource: 'waf-challenge-solver' }
            );

            return {
                success: false,
                error: (error as Error).message,
            };
        }
    }

    private async waitForTaskResult(
        taskId: string,
        apiKey: string,
        options: WafChallengeSolverOptions
    ): Promise<string | null> {
        const maxAttempts = options.maxRetries || 30; // Default: 30 attempts
        const delay = options.retryDelay || 5000; // Default: 5 seconds

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await new Promise(resolve => setTimeout(resolve, delay));

                const getResultPayload = {
                    clientKey: apiKey,
                    taskId,
                };

                const resultResponse = await axios.post(
                    `${CapSolverProvider.baseUrl}/getTaskResult`,
                    getResultPayload,
                    {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: options.timeout || 10000,
                    }
                );

                const result = resultResponse.data;

                if (result.status === 'ready' && result.solution?.cookie) {
                    console.log('WAF challenge solved successfully');
                    return result.solution.cookie;
                } else if (result.status === 'failed' || result.errorId !== 0) {
                    throw new Error(
                        `WAF solver task failed: ${result.errorDescription || 'Unknown error'}`
                    );
                }

                console.log(
                    `WAF solver task still processing... (attempt ${attempt}/${maxAttempts})`
                );
            } catch (error) {
                if (attempt === maxAttempts) {
                    throw error;
                }
                console.log(`Error polling WAF solver result (attempt ${attempt}), retrying...`);
            }
        }

        throw new Error('WAF solver task timed out after maximum attempts');
    }

    private parseAwsWafChallenge(htmlContent: string): AwsWafChallengeData {
        const challengeData: AwsWafChallengeData = {};

        try {
            // Look for gokuProps (Situation 1)
            const gokuPropsMatch = htmlContent.match(/window\.gokuProps\s*=\s*({[^}]+})/);
            if (gokuPropsMatch) {
                const gokuProps = JSON.parse(gokuPropsMatch[1]);
                if (gokuProps.key) challengeData.awsKey = gokuProps.key;
                if (gokuProps.iv) challengeData.awsIv = gokuProps.iv;
                if (gokuProps.context) challengeData.awsContext = gokuProps.context;
            }

            // Look for challenge.js URL (Situation 3)
            const challengeJsMatch = htmlContent.match(/https?:\/\/[^"'\s]*challenge\.js[^"'\s]*/);
            if (challengeJsMatch) {
                challengeData.awsChallengeJS = challengeJsMatch[0];
            }

            // Look for problem URL with visualSolutionsRequired (Situation 4)
            const visualSolutionsMatch = htmlContent.match(/visualSolutionsRequired/);
            if (visualSolutionsMatch) {
                const problemUrlMatch = htmlContent.match(
                    /https?:\/\/[^"'\s]*problem[^"'\s]*num_solutions_required[^"'\s]*/
                );
                if (problemUrlMatch) {
                    challengeData.awsProblemUrl = problemUrlMatch[0];
                }
            }

            console.log('Parsed AWS WAF challenge data:', challengeData);
        } catch (error) {
            console.log('Error parsing AWS WAF challenge data:', error);
        }

        return challengeData;
    }
}

/**
 * Main AWS WAF Challenge Solver service
 * Provides a generic interface that can use different solver providers
 */
export class AwsWafChallengeSolver {
    private static provider: IAwsWafChallengeSolver = new CapSolverProvider();

    /**
     * Set a custom WAF challenge solver provider
     */
    static setProvider(provider: IAwsWafChallengeSolver): void {
        this.provider = provider;
    }

    /**
     * Detect if a response contains an AWS WAF challenge
     */
    static detectChallenge(response: AxiosResponse): boolean {
        return this.provider.detectChallenge(response);
    }

    /**
     * Solve an AWS WAF challenge
     */
    static async solveChallenge(
        websiteURL: string,
        htmlContent: string,
        options?: WafChallengeSolverOptions
    ): Promise<WafChallengeSolverResult> {
        return this.provider.solveChallenge(websiteURL, htmlContent, options);
    }
}

export default AwsWafChallengeSolver;
