export interface CaseDataConfiguration {
    caseLink: boolean;
    caseSummary: boolean;
    parties: boolean;
    dispositionEvents: boolean;
    hearings: boolean;
    serviceEvents: boolean;
    financialSummary: boolean;
    conditions: boolean;
    bondSettings: boolean;
    placements: boolean;
}

export const defaultCaseDataConfiguration: CaseDataConfiguration = {
    caseLink: true,
    caseSummary: false,
    parties: false,
    dispositionEvents: false,
    hearings: false,
    serviceEvents: false,
    financialSummary: false,
    conditions: false,
    bondSettings: false,
    placements: false,
};

export interface WebhookSettings {
    webhookUrl: string;
    sharedSecret: string;
    // dataConfiguration: CaseDataConfiguration;
}
