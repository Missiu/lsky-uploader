import { App, Notice } from 'obsidian';

export interface LskyAuthConfig {
	serverUrl: string;
	email: string;
	password: string;
	token?: string;
}

export interface LskyImageItem {
	key: string;
	name: string;
	origin_name?: string;
	pathname?: string;
	size?: number;
	links: { url: string; thumbnail_url?: string };
}

interface LskyListResponse {
	data: {
		current_page: number;
		last_page: number;
		data: LskyImageItem[];
	};
}

export class LskyClient {
	private app: App;
	private config: LskyAuthConfig;
	private isFetchingToken: boolean = false;

	constructor(app: App, config: LskyAuthConfig) {
		this.app = app;
		this.config = config;
	}

	private get baseUrl(): string {
		return this.config.serverUrl.replace(/\/$/, '');
	}

	async getToken(): Promise<string> {
		if (this.isFetchingToken) {
			// Small wait loop to avoid concurrent POST /tokens
			await new Promise(r => setTimeout(r, 200));
			return this.getToken();
		}
		this.isFetchingToken = true;
		try {
			const res = await fetch(`${this.baseUrl}/tokens`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
				body: JSON.stringify({ email: this.config.email, password: this.config.password })
			});
			if (!res.ok) throw new Error('HTTP ' + res.status);
			const json = await res.json();
			if (!json?.status || !json?.data?.token) throw new Error(json?.message || 'no token');
			this.config.token = json.data.token as string;
			return this.config.token;
		} finally {
			this.isFetchingToken = false;
		}
	}

	private async authorizedFetch(input: string, init: RequestInit = {}, retry401: boolean = true): Promise<Response> {
		const headers: Record<string, string> = {
			'Accept': 'application/json',
			...(init.headers as Record<string, string> || {})
		};
		if (this.config.token) headers['Authorization'] = `Bearer ${this.config.token}`;
		const res = await fetch(input, { ...init, headers });
		if (res.status === 401 && retry401) {
			await this.getToken();
			return this.authorizedFetch(input, init, false);
		}
		return res;
	}

	async uploadBinary(binary: ArrayBuffer, filename: string, mimeType: string, strategyId?: number): Promise<string> {
		const form = new FormData();
		form.append('file', new Blob([binary], { type: mimeType }), filename);
		// Some Lsky setups require strategy_id; default to 1 if not provided
		form.append('strategy_id', String(strategyId ?? 1));
		const res = await this.authorizedFetch(`${this.baseUrl}/upload`, { method: 'POST', body: form });
		if (!res.ok) {
			let details = '';
			try { details = await res.text(); } catch {}
			throw new Error(`HTTP ${res.status}${details ? ` - ${details}` : ''}`);
		}
		let json: any;
		try { json = await res.json(); } catch (e) { throw new Error('Invalid JSON from server'); }
		if (!json?.status || !json?.data?.links?.url) throw new Error(json?.message || 'upload failed');
		return json.data.links.url as string;
	}

	async listAllImages(): Promise<LskyImageItem[]> {
		let page = 1;
		let last = 1;
		const result: LskyImageItem[] = [];
		do {
			const res = await this.authorizedFetch(`${this.baseUrl}/images?page=${page}`);
			if (!res.ok) throw new Error('HTTP ' + res.status);
			const json: LskyListResponse = await res.json();
			const items = json?.data?.data || [];
			result.push(...items);
			last = json?.data?.last_page || page;
			page++;
			await new Promise(r => setTimeout(r, 80));
		} while (page <= last);
		return result;
	}

	async deleteImageByKey(key: string): Promise<void> {
		const res = await this.authorizedFetch(`${this.baseUrl}/images/${encodeURIComponent(key)}`, { method: 'DELETE' });
		if (!res.ok) throw new Error('HTTP ' + res.status);
	}
}

export function getServerOrigin(serverUrl: string): string | null {
	try {
		const u = new URL(serverUrl);
		return `${u.protocol}//${u.host}`;
	} catch {
		return null;
	}
}

