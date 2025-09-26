import {App, Modal, requestUrl} from 'obsidian';
import {getServerOrigin} from '../api/lsky';

export async function collectUsedUploadedImages(app: App, serverUrl: string): Promise<string[]> {
	const origin = getServerOrigin(serverUrl);
	if (!origin) return [];
	const files = app.vault.getMarkdownFiles();
	const set = new Set<string>();
	for (const f of files) {
		const content = await app.vault.read(f);
		const md = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g) || [];
		const html = content.match(/<img[^>]+src="(https?:\/\/[^">]+)"/g) || [];
		const wiki = content.match(/!\[\[(https?:\/\/[^\]]+)\]\]/g) || [];
		[...md, ...html, ...wiki].forEach(s => {
			const url = s.replace(/!\[.*?\]\(|\)|<img[^>]+src="|"|!\[\[|\]\]/g, '');
			if (url && url.startsWith(origin)) set.add(url);
		});
	}
	return Array.from(set);
}

export async function showUsedImages(app: App, serverUrl: string): Promise<void> {
    const urls = await collectUsedUploadedImages(app, serverUrl);
    class PreviewModal extends Modal {
        private url: string;
        constructor(url: string) { super(app); this.url = url; }
        async onOpen() {
            const { contentEl } = this;
            contentEl.empty();
            try {
                const res = await requestUrl({ url: this.url, method: 'GET' });
                const blob = new Blob([res.arrayBuffer]);
                const objectUrl = URL.createObjectURL(blob);
                const img = contentEl.createEl('img');
                img.src = objectUrl;
                img.style.maxWidth = '100%';
                img.style.maxHeight = '70vh';
            } catch {
                contentEl.createEl('div', { text: '预览加载失败' });
            }
        }
    }
    class ViewModal extends Modal {
        private urls: string[];
        constructor() { super(app); this.urls = urls; }
        onOpen() {
            const { contentEl } = this;
            contentEl.empty();
            contentEl.createEl('h2', { text: '已被使用且已上传至图床的图片' });
            contentEl.createEl('p', { text: `共 ${this.urls.length} 项（仅显示当前配置图床域名）` });
            const grid = contentEl.createDiv({ cls: 'lsky-used-images-grid' });
            grid.setAttr('style', 'display:grid;grid-template-columns:repeat(auto-fill, minmax(120px,1fr));gap:8px;');
            this.urls.forEach(u => {
                const card = grid.createDiv({ cls: 'lsky-thumb' });
                const thumb = card.createEl('img', { attr: { src: u } });
                thumb.style.width = '100%';
                thumb.style.height = '100px';
                thumb.style.objectFit = 'cover';
                thumb.addEventListener('click', () => new PreviewModal(u).open());
                const link = card.createEl('div', { text: u });
                link.style.fontSize = '10px';
                link.style.wordBreak = 'break-all';
            });
        }
    }
    new ViewModal().open();
}


