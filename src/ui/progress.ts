import {App, Modal} from 'obsidian';

export class ProgressModal extends Modal {
	private titleText: string;
	private barEl?: HTMLDivElement;
	private textEl?: HTMLDivElement;
	private current = 0;
	private total = 0;

	constructor(app: App, title: string) {
		super(app);
		this.titleText = title;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: this.titleText });
		const barWrap = contentEl.createDiv({ cls: 'lsky-progress-wrap' });
		barWrap.setAttr('style', 'width:100%;height:10px;background:#eee;border-radius:6px;overflow:hidden;margin:8px 0;');
		this.barEl = barWrap.createDiv({ cls: 'lsky-progress-bar' });
		this.barEl.setAttr('style', 'height:100%;width:0%;background:#5b8def;transition:width 0.2s;');
		this.textEl = contentEl.createDiv({ cls: 'lsky-progress-text' });
		this.textEl.setText('0 / 0');
	}

	setTotal(total: number) {
		this.total = Math.max(0, total);
		this.render();
	}

	setProgress(current: number, total?: number, message?: string) {
		this.current = Math.max(0, current);
		if (typeof total === 'number') this.total = Math.max(0, total);
		this.render(message);
	}

	increment(message?: string) {
		this.setProgress(this.current + 1, undefined, message);
	}

	private render(message?: string) {
		const pct = this.total > 0 ? Math.min(100, Math.round((this.current / this.total) * 100)) : 0;
		if (this.barEl) this.barEl.style.width = pct + '%';
		if (this.textEl) this.textEl.setText(`${this.current} / ${this.total}${message ? ` - ${message}` : ''}`);
	}
}


