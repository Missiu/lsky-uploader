import { App, Modal, Notice } from 'obsidian';
import { LskyClient, LskyImageItem, getServerOrigin } from '../api/lsky';
import { ProgressModal } from '../ui/progress';

export async function collectUsedImageUrls(app: App, serverOrigin: string): Promise<string[]> {
	const files = app.vault.getMarkdownFiles();
	const set = new Set<string>();
	for (const f of files) {
		const content = await app.vault.read(f);
		const md = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g) || [];
		const html = content.match(/<img[^>]+src="(https?:\/\/[^">]+)"/g) || [];
		const wiki = content.match(/!\[\[(https?:\/\/[^\]]+)\]\]/g) || [];
		[...md, ...html, ...wiki].forEach(s => {
			const url = s.replace(/!\[.*?\]\(|\)|<img[^>]+src="|"|!\[\[|\]\]/g, '');
			if (url && url.startsWith(serverOrigin)) set.add(url);
		});
	}
	return Array.from(set);
}

export async function confirmCleanup(app: App, unused: LskyImageItem[], total: number): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		class ConfirmModal extends Modal {
			private unused: LskyImageItem[]; private total: number;
			constructor() { super(app); this.unused = unused; this.total = total; }
			onOpen() {
				const { contentEl } = this;
				contentEl.empty();
				contentEl.createEl('h2', { text: '确认清理未使用图片' });
				contentEl.createEl('p', { text: `图床总图片数：${this.total}，未使用的图片：${this.unused.length}` });
				if (this.unused.length > 0) {
					contentEl.createEl('h3', { text: '将要删除的图片链接（前20个）' });
					this.unused.slice(0, 20).forEach(img => contentEl.createEl('div', { text: img.links.url }));
					if (this.unused.length > 20) contentEl.createEl('p', { text: `…… 还有 ${this.unused.length - 20} 个未列出` });
				}
				const row = contentEl.createDiv({ cls: 'modal-button-container' });
				const confirmBtn = row.createEl('button', { text: '确认清理' });
				confirmBtn.addEventListener('click', () => { resolve(true); this.close(); });
				const cancelBtn = row.createEl('button', { text: '取消' });
				cancelBtn.addEventListener('click', () => { resolve(false); this.close(); });
			}
			shouldCloseOnClickOutside() { return false; }
		}
		new ConfirmModal().open();
	});
}

export async function showCleanupResult(app: App, success: string[], failed: string[]) {
	class ResultModal extends Modal {
		private success: string[]; private failed: string[];
		constructor() { super(app); this.success = success; this.failed = failed; }
		onOpen() {
			const { contentEl } = this;
			contentEl.empty();
			contentEl.createEl('h2', { text: '清理结果' });
			contentEl.createEl('p', { text: `成功删除 ${this.success.length} 个，失败 ${this.failed.length} 个` });
			if (this.success.length) { contentEl.createEl('h3', { text: '已删除：' }); this.success.forEach(u => contentEl.createEl('div', { text: u })); }
			if (this.failed.length) { contentEl.createEl('h3', { text: '失败：' }); this.failed.forEach(u => contentEl.createEl('div', { text: u })); }
		}
		shouldCloseOnClickOutside() { return false; }
	}
	new ResultModal().open();
}

export async function cleanupUnusedImages(app: App, client: LskyClient, serverUrl: string): Promise<void> {
	const origin = getServerOrigin(serverUrl);
	if (!origin) { new Notice('无效的服务器地址'); return; }
	new Notice('开始扫描未使用的图片...');
	const [used, all] = await Promise.all([
		collectUsedImageUrls(app, origin),
		client.listAllImages()
	]);
    const toDelete = all.filter((img: LskyImageItem) => !used.includes(img.links.url));
	if (toDelete.length === 0) { new Notice('没有发现未使用的图片'); return; }
	const confirmed = await confirmCleanup(app, toDelete, all.length);
	if (!confirmed) { new Notice('操作已取消'); return; }
    const success: string[] = []; const failed: string[] = [];
    const progress = new ProgressModal(app, '清理未被引用的图片');
    progress.open();
    progress.setTotal(toDelete.length);
    for (const img of toDelete) {
        try { await client.deleteImageByKey(img.key); success.push(img.links.url); }
        catch { failed.push(img.links.url); }
        progress.increment(img.name || img.links.url);
        await new Promise(r => setTimeout(r, 150));
    }
    progress.close();
	await showCleanupResult(app, success, failed);
}


