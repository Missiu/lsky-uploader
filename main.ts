import {App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting} from 'obsidian';
import {LskyClient} from './src/api/lsky';
import {CustomUploader} from './src/features/upload';
import {cleanupUnusedImages} from './src/features/cleanup';
import {showUsedImages} from './src/features/view';

interface LskySettings {
    serverUrl: string;
    email: string;
    password: string;
    token: string;
    autoCleanupOnStartup: boolean;
}

const DEFAULT_SETTINGS: LskySettings = {
    serverUrl: 'https://lsky.example.com/api/v1',
    email: '',
    password: '',
    token: '',
    autoCleanupOnStartup: false
}

export default class LskyPlugin extends Plugin {
    settings: LskySettings;
    private client?: LskyClient;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new LskySettingTab(this.app, this));

        this.refreshClient();

        // Always show left ribbon buttons per updated requirement
        const ribbonsEnabled = true;

        // Ribbon: upload all local images in current note
        const uploadRibbon = this.addRibbonIcon('image-plus', '上传本地图片到图床', async () => {
            await this.ensureClient();
            if (!this.client) return;
            const uploader = new CustomUploader(this.app, this.client);
            await uploader.uploadAllLocalImages();
        });
        uploadRibbon.addClass('lsky-upload-ribbon');
        if (!ribbonsEnabled) uploadRibbon.hide();

        // Ribbon: view used images
        const viewRibbon = this.addRibbonIcon('list', '查看已使用的图床图片', async () => {
            await showUsedImages(this.app, this.settings.serverUrl);
        });
        viewRibbon.addClass('lsky-view-ribbon');
        if (!ribbonsEnabled) viewRibbon.hide();

        // Ribbon: cleanup
        const cleanupRibbon = this.addRibbonIcon('trash', '清理未被引用的图床图片', async () => {
            await this.ensureClient();
            if (!this.client) return;
            await cleanupUnusedImages(this.app, this.client, this.settings.serverUrl);
        });
        cleanupRibbon.addClass('lsky-cleanup-ribbon');
        if (!ribbonsEnabled) cleanupRibbon.hide();

        const dlCurrentRibbon = this.addRibbonIcon('download', '下载当前笔记图床图片并更新引用', async () => {
            await this.ensureClient();
            const { downloadImagesForCurrentNote } = await import('./src/features/download');
            await downloadImagesForCurrentNote(this.app, this.settings.serverUrl);
        });
        dlCurrentRibbon.addClass('lsky-dl-current-ribbon');
        if (!ribbonsEnabled) dlCurrentRibbon.hide();

        const dlAllRibbon = this.addRibbonIcon('download', '下载所有笔记图床图片并更新引用', async () => {
            await this.ensureClient();
            const { downloadImagesForAllNotes } = await import('./src/features/download');
            await downloadImagesForAllNotes(this.app, this.settings.serverUrl);
        });
        dlAllRibbon.addClass('lsky-dl-all-ribbon');
        if (!ribbonsEnabled) dlAllRibbon.hide();

        // Command: upload (works when cursor on image link or selection contains local image)
        this.addCommand({
            id: 'lsky-upload-images-in-note',
            name: '上传当前笔记的本地图片到图床',
            editorCallback: async (_editor: Editor, _view: MarkdownView) => {
                await this.ensureClient();
                if (!this.client) return;
                const uploader = new CustomUploader(this.app, this.client);
                await uploader.uploadAllLocalImages();
            }
        });

        this.addCommand({
            id: 'lsky-view-used-images',
            name: '查看已使用的图床图片',
            callback: async () => {
                await showUsedImages(this.app, this.settings.serverUrl);
            }
        });

        this.addCommand({
            id: 'lsky-cleanup-unused-images',
            name: '清理未被引用的图床图片',
            callback: async () => {
                await this.ensureClient();
                if (!this.client) return;
                await cleanupUnusedImages(this.app, this.client, this.settings.serverUrl);
            }
        });

        this.addCommand({
            id: 'lsky-download-current-note-images',
            name: '下载当前笔记图床图片并更新引用',
            callback: async () => {
                await this.ensureClient();
                const { downloadImagesForCurrentNote } = await import('./src/features/download');
                await downloadImagesForCurrentNote(this.app, this.settings.serverUrl);
            }
        });

        this.addCommand({
            id: 'lsky-download-all-notes-images',
            name: '下载所有笔记图床图片并更新引用',
            callback: async () => {
                await this.ensureClient();
                const { downloadImagesForAllNotes } = await import('./src/features/download');
                await downloadImagesForAllNotes(this.app, this.settings.serverUrl);
            }
        });

        if (this.settings.autoCleanupOnStartup) {
            setTimeout(async () => {
                try {
                    const confirmed = await confirmAutoCleanup(this.app);
                    if (!confirmed) return;
                    await this.ensureClient();
                    if (!this.client) return;
                    await cleanupUnusedImages(this.app, this.client, this.settings.serverUrl);
                } catch { /* empty */ }
            }, 500);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.refreshClient();
        // Update ribbons visibility
        // Note: Obsidian API doesn't expose existing ribbons easily; reloading is simplest.
    }

    private refreshClient() {
        this.client = new LskyClient(this.app, {
            serverUrl: this.settings.serverUrl,
            email: this.settings.email,
            password: this.settings.password,
            token: this.settings.token
        });
    }

    async ensureClient() {
        if (!this.client) this.refreshClient();
        try {
            // lazy ensure token if missing
            if (!this.settings.token) {
                const token = await this.client!.getToken();
                this.settings.token = token;
                await this.saveSettings();
                new Notice('已自动获取 Token');
            }
        } catch (e) {
            new Notice('无法获取 Token：' + (e as Error).message);
        }
    }

}

class LskySettingTab extends PluginSettingTab {
    plugin: LskyPlugin;

    constructor(app: App, plugin: LskyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Lsky 图床设置' });

        new Setting(containerEl)
            .setName('图床服务器地址')
            .setDesc('例如：https://lsky.example.com/api/v1')
            .addText(text => text
                .setPlaceholder('https://.../api/v1')
                .setValue(this.plugin.settings.serverUrl)
                .onChange(async (value) => {
                    this.plugin.settings.serverUrl = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('用户邮箱')
            .addText(text => text
                .setPlaceholder('name@example.com')
                .setValue(this.plugin.settings.email)
                .onChange(async (value) => {
                    this.plugin.settings.email = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('用户密码')
            .addText(text => text
                .setPlaceholder('••••••••')
                .setValue(this.plugin.settings.password)
                .onChange(async (value) => {
                    this.plugin.settings.password = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Token')
            .setDesc('可留空，插件会自动获取；也可手动粘贴已获取的 Token')
            .addText(text => text
                .setPlaceholder('可选')
                .setValue(this.plugin.settings.token)
                .onChange(async (value) => {
                    this.plugin.settings.token = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('测试登录并获取 Token')
                .onClick(async () => {
                    try {
                        const token = await testFetchToken(this.plugin.settings);
                        this.plugin.settings.token = token;
                        await this.plugin.saveSettings();
                        new Notice('获取 Token 成功');
                    } catch (e) {
                        new Notice('获取 Token 失败：' + (e as Error).message);
                    }
                }));

        // 按要求移除左侧边栏显示开关，始终显示按钮

        new Setting(containerEl)
            .setName('启动时自动清理未引用图片')
            .setDesc('启动 Obsidian 后提示确认并清理未引用的图床图片')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCleanupOnStartup)
                .onChange(async (v) => {
                    this.plugin.settings.autoCleanupOnStartup = v;
                    await this.plugin.saveSettings();
                }));

		// 添加联系作者部分
		containerEl.createEl('h2', { text: '联系作者' });

		const contactSection = containerEl.createDiv({ cls: 'lsky-contact-section' });
		contactSection.createEl('p', {
			text: '如有任何问题、bug提交或功能需求，请联系作者：'
		});
		contactSection.createEl('p', {
			text: '邮箱：huzhihaonet@foxmail.com'
		});

		// 添加样式
		const style = containerEl.createEl('style');
		style.textContent = `
        .lsky-contact-section {
            padding: 10px 15px;
            background-color: var(--background-secondary);
            border-radius: 6px;
            margin: 20px 0;
            border: 1px solid var(--background-modifier-border);
        }
        .lsky-contact-section p {
            margin: 5px 0;
        }
    `;
    }
}

async function testFetchToken(settings: LskySettings): Promise<string> {
    const url = settings.serverUrl.replace(/\/$/, '') + '/tokens';
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ email: settings.email, password: settings.password })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json?.status || !json?.data?.token) throw new Error(json?.message || '返回数据无 token');
    return json.data.token as string;
}

// Sidebar view removed per updated requirement

async function confirmAutoCleanup(app: App): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        class ConfirmModal extends Modal {
            constructor(app: App) { super(app); }
            onOpen() {
                const { contentEl } = this;
                contentEl.empty();
                contentEl.createEl('h2', { text: '启动清理确认' });
                contentEl.createEl('p', { text: '是否开始清理未引用的图床图片？' });
                const row = contentEl.createDiv({ cls: 'modal-button-container' });
                const ok = row.createEl('button', { text: '开始清理' });
                ok.addEventListener('click', () => { resolve(true); this.close(); });
                const cancel = row.createEl('button', { text: '取消' });
                cancel.addEventListener('click', () => { resolve(false); this.close(); });
            }
            shouldCloseOnClickOutside() { return false; }
        }
        new ConfirmModal(app).open();
    });
}
