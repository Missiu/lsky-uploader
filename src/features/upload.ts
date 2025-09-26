import {App, Notice, TFile} from 'obsidian';
import {LskyClient} from '../api/lsky';
import {ProgressModal} from '../ui/progress';

export class CustomUploader {
	private app: App;
	private client: LskyClient;
	private retryCount = 0;
	private readonly maxRetries = 2;

	constructor(app: App, client: LskyClient) {
		this.app = app;
		this.client = client;
	}

	generateTimestampFilename(originalName: string, noteFile?: TFile): string {
		const baseName = noteFile ? noteFile.basename : 'file';
		const timestamp = Date.now();
		const ext = (originalName.split('.').pop() || 'bin');
		return `${baseName}-${timestamp}.${ext}`;
	}

	replaceImageLink(content: string, oldPath: string, newUrl: string): string {
		const escapedPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		content = content.replace(new RegExp(`!\\[.*?\\]\\(${escapedPath}\\)`, 'g'), `![](${newUrl})`);
		content = content.replace(new RegExp(`<img[^>]+src="${escapedPath}"`, 'g'), `<img src="${newUrl}"`);
		content = content.replace(new RegExp(`!\\[\\[${escapedPath}\\]\\]`, 'g'), `![](${newUrl})`);
		return content;
	}

    isLocalPath(path: string): boolean {
        if (!path) return false;
        const isHttp = /^https?:\/\//i.test(path);
        const isProtocolRelative = /^\/\//.test(path);
        const isData = /^data:/.test(path);
        return !isHttp && !isProtocolRelative && !isData;
    }

	extractLocalImagePaths(content: string): string[] {
		const paths = new Set<string>();
		const markdownRegex = /!\[.*?\]\(([^)]+)\)/g;
		const htmlRegex = /<img[^>]+src="([^">]+)"/g;
		const wikiRegex = /!\[\[([^\]]+)\]\]/g;
		let m: RegExpExecArray | null;
		while ((m = markdownRegex.exec(content)) !== null) { const p = m[1].trim(); if (this.isLocalPath(p)) paths.add(p); }
		while ((m = htmlRegex.exec(content)) !== null) { const p = m[1].trim(); if (this.isLocalPath(p)) paths.add(p); }
		while ((m = wikiRegex.exec(content)) !== null) { const p = m[1].trim(); if (this.isLocalPath(p)) paths.add(p); }
		return Array.from(paths);
	}

	resolveImagePath(imagePath: string, noteFile: TFile): string {
		const normalized = imagePath.replace(/\\/g, '/');
		const cleanPath = normalized
			.replace(/%20/g, ' ')
			.replace(/^\[\[|\]\]$/g, '')
			.replace(/^\.\//, '')
			.trim();
		if (cleanPath.startsWith('/')) return cleanPath.substring(1);
		const noteDir = noteFile.parent ? noteFile.parent.path : '';
		return noteDir ? `${noteDir}/${cleanPath}` : cleanPath;
	}

	getAlternativePaths(imagePath: string, noteFile: TFile): string[] {
		const raw = imagePath
			.replace(/\\/g, '/')
			.replace(/%20/g, ' ')
			.replace(/^\[\[|\]\]$/g, '')
			.replace(/^\.\//, '')
			.trim();
		const variants = new Set<string>();
		variants.add(raw);
		try { variants.add(decodeURIComponent(raw)); } catch { /* empty */ }
		const alternatives: string[] = [];
		for (const v of variants) {
			alternatives.push(this.resolveImagePath(v, noteFile));
			if (v.includes('attachments/')) alternatives.push(v.replace('attachments/', ''));
			alternatives.push(v);
			if (!v.startsWith('attachments/')) alternatives.push(`attachments/${v}`);
			if (noteFile.parent && noteFile.parent.path !== '') alternatives.push(`${noteFile.parent.path}/${v}`);
			alternatives.push(`Attachments/${v}`);
			// try same-named folder beside note
			const baseNameOnly = v.split('/').pop();
			if (baseNameOnly) alternatives.push(`${noteFile.parent ? noteFile.parent.path + '/' : ''}${noteFile.basename}/${baseNameOnly}`);
		}
		return Array.from(new Set(alternatives.filter(Boolean)));
	}

	private findFileByBasename(basename: string): TFile | null {
		const files = this.app.vault.getFiles();
		for (const f of files) { if (f.name === basename) return f; }
		try {
			const decoded = decodeURIComponent(basename);
			for (const f of files) { if (f.name === decoded) return f; }
		} catch { /* empty */ }
		return null;
	}

	getImageMimeType(extension: string): string {
		const map: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', jfif: 'image/jpeg' };
		return map[(extension || '').toLowerCase()] || 'application/octet-stream';
	}

	async uploadLocalImage(imagePath: string, noteFile: TFile): Promise<string> {
		const decoded = (() => { try { return decodeURIComponent(imagePath); } catch { return imagePath; } })();
		const absolutePath = this.resolveImagePath(decoded, noteFile);
		let file = this.app.vault.getAbstractFileByPath(absolutePath);
		if (!file) {
			for (const alt of this.getAlternativePaths(decoded, noteFile)) {
				const f = this.app.vault.getAbstractFileByPath(alt);
				if (f) { file = f; break; }
			}
			if (!file) {
				const base = (decoded.replace(/\\/g, '/').split('/').pop() || '').replace(/^\[\[|\]\]$/g, '');
				const guess = this.findFileByBasename(base);
				if (guess) file = guess;
			}
		}
		if (!file || !(file instanceof TFile)) throw new Error(`找不到图片文件: ${absolutePath}`);
		const binary = await this.app.vault.readBinary(file);
		const safeName = this.generateTimestampFilename(file.name.replace(/[^\w\-.]+/g, '_'), noteFile);
		const url = await this.client.uploadBinary(binary, safeName, this.getImageMimeType(file.extension));
		return url;
	}

	async uploadAllLocalImages(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) { new Notice('没有活动的笔记'); return; }
		const content = await this.app.vault.read(activeFile);
		const localPaths = this.extractLocalImagePaths(content);
		if (localPaths.length === 0) { new Notice('当前笔记中没有本地图片'); return; }
        new Notice(`找到 ${localPaths.length} 张本地图片，开始上传...`);
        let success = 0; let updated = content;
        const progress = new ProgressModal(this.app, '上传本地图片到图床');
        progress.open();
        progress.setTotal(localPaths.length);
        for (const p of localPaths) {
			try {
				const url = await this.uploadLocalImage(p, activeFile);
				updated = this.replaceImageLink(updated, p, url);
				success++;
				new Notice(`上传成功 (${success}/${localPaths.length}): ${p.split('/').pop()}`);
                progress.increment(p.split('/').pop() || '');
			} catch (e) {
				new Notice(`上传失败: ${p} - ${(e as Error).message}`);
                progress.increment('失败');
			}
		}
        progress.close();
		if (success > 0) await this.app.vault.modify(activeFile, updated);
		new Notice(`图片上传完成，成功 ${success}/${localPaths.length}`);
	}
}


