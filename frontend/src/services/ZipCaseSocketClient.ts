import { fetchAuthSession } from '@aws-amplify/core';
import { WS_URL } from '../aws-exports';

type SubjectType = 'case';

type SocketEvent = {
    type: 'case.status.updated';
    subjectType: SubjectType;
    subjectId: string;
    payload: unknown;
    timestamp: string;
};

type Handler = (event: SocketEvent) => void;

class ZipCaseSocketClient {
    private socket: WebSocket | null = null;
    private handlers = new Set<Handler>();
    private connected = false;
    private shouldReconnect = true;
    private reconnectDelayMs = 1000;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly subscriptions = new Map<SubjectType, Set<string>>();

    async connect(): Promise<void> {
        if (!WS_URL) {
            return;
        }

        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const session = await fetchAuthSession();
        const token = session.tokens?.accessToken?.toString();
        if (!token) {
            throw new Error('No authentication token available for WebSocket connection');
        }

        const url = new URL(WS_URL);
        url.searchParams.set('authorization', `Bearer ${token}`);

        this.socket = new WebSocket(url.toString());

        this.socket.onopen = () => {
            this.connected = true;
            this.reconnectDelayMs = 1000;
            this.replaySubscriptions();
        };

        this.socket.onmessage = event => {
            try {
                const parsed = JSON.parse(event.data) as SocketEvent;
                this.handlers.forEach(handler => handler(parsed));
            } catch (error) {
                console.error('Failed to parse WebSocket event', error);
            }
        };

        this.socket.onclose = () => {
            this.connected = false;
            this.socket = null;
            if (this.shouldReconnect) {
                this.scheduleReconnect();
            }
        };

        this.socket.onerror = () => {
            this.connected = false;
        };
    }

    disconnect(): void {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.connected = false;
    }

    onMessage(handler: Handler): () => void {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    subscribe(subjectType: SubjectType, subjects: string[]): void {
        const normalized = Array.from(new Set(subjects.map(subject => subject.toUpperCase())));
        if (normalized.length === 0) {
            return;
        }

        if (!this.subscriptions.has(subjectType)) {
            this.subscriptions.set(subjectType, new Set());
        }

        const set = this.subscriptions.get(subjectType)!;
        normalized.forEach(subject => set.add(subject));

        this.send({ subjectType, subjects: normalized }, 'subscribe');
    }

    unsubscribe(subjectType: SubjectType, subjects: string[]): void {
        const normalized = Array.from(new Set(subjects.map(subject => subject.toUpperCase())));
        if (normalized.length === 0) {
            return;
        }

        const set = this.subscriptions.get(subjectType);
        if (set) {
            normalized.forEach(subject => set.delete(subject));
        }

        this.send({ subjectType, subjects: normalized }, 'unsubscribe');
    }

    isConnected(): boolean {
        return this.connected;
    }

    private send(payload: { subjectType: SubjectType; subjects: string[] }, action: 'subscribe' | 'unsubscribe') {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        this.socket.send(
            JSON.stringify({
                action,
                ...payload,
            })
        );
    }

    private replaySubscriptions() {
        this.subscriptions.forEach((subjects, subjectType) => {
            if (subjects.size === 0) {
                return;
            }
            this.send({ subjectType, subjects: Array.from(subjects) }, 'subscribe');
        });
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) {
            return;
        }

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            try {
                await this.connect();
            } catch (error) {
                console.error('WebSocket reconnect failed', error);
                this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 10000);
                this.scheduleReconnect();
            }
        }, this.reconnectDelayMs);
    }
}

export const zipCaseSocketClient = new ZipCaseSocketClient();
