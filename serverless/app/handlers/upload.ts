import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import AlertService, { Severity, AlertCategory } from '../../lib/AlertService';

const s3Client = new S3Client({});

export const getUploadUrl: APIGatewayProxyHandler = async event => {
    try {
        const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized' }),
            };
        }

        const bucketName = process.env.UPLOADS_BUCKET;
        if (!bucketName) {
            throw new Error('UPLOADS_BUCKET environment variable is not set');
        }

        const fileExtension = event.queryStringParameters?.extension || 'pdf';
        const contentType = event.queryStringParameters?.contentType || 'application/octet-stream';
        const key = `uploads/${userId}/${randomUUID()}.${fileExtension}`;

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            ContentType: contentType,
        });

        // URL expires in 5 minutes
        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                uploadUrl,
                key,
            }),
        };
    } catch (error) {
        await AlertService.logError(Severity.ERROR, AlertCategory.SYSTEM, 'Error generating upload URL', error as Error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: (error as Error).message,
            }),
        };
    }
};
