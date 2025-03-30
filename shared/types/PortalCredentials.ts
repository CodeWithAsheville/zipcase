export interface PortalCredentialsRequest {
    username: string;
    password: string;
}

export interface PortalCredentialsResponse {
    username: string;
    isBad: boolean;
}
