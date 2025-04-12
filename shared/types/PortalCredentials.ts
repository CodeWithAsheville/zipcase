export interface PortalCredentials {
    username: string;
    password: string;
    isBad: boolean;
}

export interface PortalCredentialsRequest {
    username: string;
    password: string;
}

export interface PortalCredentialsResponse {
    username: string;
    isBad: boolean;
}
