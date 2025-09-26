import {App, Notice, requestUrl, TFile} from 'obsidian';
import {ProgressModal} from '../ui/progress';
import {getServerOrigin} from '../api/lsky';

function extractRemoteImageUrls(content: string, origin: string): string[] {
	const set = new Set<string>();
	const md = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g) || [];
	const html = content.match(/<img[^>]+src="(https?:\/\/[^">]+)"/g) || [];
	const wiki = content.match(/!\[\[(https?:\/\/[^\]]+)\]\]/g) || [];
	[...md, ...html, ...wiki].forEach(s => {
		const url = s.replace(/!\[.*?\]\(|\)|<img[^>]+src="|"|!\[\[|\]\]/g, '');
		if (url && url.startsWith(origin)) set.add(url);
	});
	return Array.from(set);
}

function fileNameFromUrl(url: string): string {
	try {
		const u = new URL(url);
		const name = u.pathname.split('/').pop() || 'image';
		// Decode URL-encoded characters like %E8%99%9A to Chinese characters
		return decodeURIComponent(name);
	} catch { return 'image'; }
}

function replaceUrlWithRelative(content: string, url: string, fileName: string): string {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Use just the filename without path, as requested
    content = content.replace(new RegExp(`!\\[.*?\\]\\(${escaped}\\)`, 'g'), `![[${fileName}]]`);
    content = content.replace(new RegExp(`<img[^>]+src="${escaped}"[^>]*>`, 'g'), `![[${fileName}]]`);
    content = content.replace(new RegExp(`!\\[\\[${escaped}\\]\\]`, 'g'), `![[${fileName}]]`);
    return content;
}

async function ensureFolder(app: App, path: string) {
	const exists = app.vault.getAbstractFileByPath(path);
	if (!exists) await app.vault.createFolder(path);
}

async function downloadToBinary(url: string): Promise<ArrayBuffer> {
    const res = await requestUrl({ url, method: 'GET' });
    return res.arrayBuffer;
}

export async function downloadImagesForCurrentNote(app: App, serverUrl: string): Promise<void> {
	const origin = getServerOrigin(serverUrl);
	if (!origin) { new Notice('无效的服务器地址'); return; }
	const file = app.workspace.getActiveFile();
	if (!file) { new Notice('没有活动的笔记'); return; }
	const content = await app.vault.read(file);
	const urls = extractRemoteImageUrls(content, origin);
	if (urls.length === 0) { new Notice('未发现需下载的图床图片'); return; }
	const folder = `${file.parent ? file.parent.path + '/' : ''}${file.basename}`;
	await ensureFolder(app, folder);
    let updated = content;
    const progress = new ProgressModal(app, '下载当前笔记图片');
    progress.open();
    progress.setTotal(urls.length);
    for (const url of urls) {
		try {
			const bin = await downloadToBinary(url);
			const name = fileNameFromUrl(url);
			const target = `${folder}/${name}`;
			const exists = app.vault.getAbstractFileByPath(target);
			if (exists instanceof TFile) {
				await app.vault.modifyBinary(exists, bin);
			} else {
				await app.vault.createBinary(target, bin);
			}
			updated = replaceUrlWithRelative(updated, url, name);
            progress.increment(name);
		} catch (e) {
			new Notice(`下载失败：${url}`);
            progress.increment('失败');
		}
	}
    progress.close();
	await app.vault.modify(file, updated);
	new Notice(`下载完成：${urls.length} 张图片`);
}

export async function downloadImagesForAllNotes(app: App, serverUrl: string): Promise<void> {
	const origin = getServerOrigin(serverUrl);
	if (!origin) { new Notice('无效的服务器地址'); return; }
	const files = app.vault.getMarkdownFiles();
	let total = 0;
    const progress = new ProgressModal(app, '下载所有笔记图片');
    progress.open();
    progress.setTotal(files.length);
    for (const f of files) {
		let content = await app.vault.read(f);
		const urls = extractRemoteImageUrls(content, origin);
		if (urls.length === 0) continue;
		const folder = `${f.parent ? f.parent.path + '/' : ''}${f.basename}`;
		await ensureFolder(app, folder);
		for (const url of urls) {
			try {
				const bin = await downloadToBinary(url);
				const name = fileNameFromUrl(url);
				const target = `${folder}/${name}`;
				const exists = app.vault.getAbstractFileByPath(target);
				if (exists instanceof TFile) {
					await app.vault.modifyBinary(exists, bin);
				} else {
					await app.vault.createBinary(target, bin);
				}
				content = replaceUrlWithRelative(content, url, name);
				total++;
			} catch { /* empty */ }
		}
		await app.vault.modify(f, content);
        progress.increment(f.basename);
	}
    progress.close();
	new Notice(`全部下载完成：${total} 张图片`);
}


