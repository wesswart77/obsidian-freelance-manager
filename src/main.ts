import {
	App,
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	normalizePath,
} from "obsidian";

// ─── Types ───────────────────────────────────────────────────────────────────

type RateType = "hourly" | "fixed";
type ProjectStatus = "active" | "paused" | "complete";

interface FreelanceSettings {
	clientsFolder: string;
	projectsFolder: string;
	invoicesFolder: string;
}

const DEFAULT_SETTINGS: FreelanceSettings = {
	clientsFolder: "Freelance/Clients",
	projectsFolder: "Freelance/Projects",
	invoicesFolder: "Freelance/Invoices",
};

const FM_VIEW_TYPE = "fm-dashboard-view";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function today(): string {
	return new Date().toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
	const d = new Date(dateStr);
	d.setDate(d.getDate() + days);
	return d.toISOString().split("T")[0];
}

function fmtDate(d: string): string {
	if (!d) return "";
	const parts = d.split("-");
	if (parts.length < 3) return d;
	return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function formatCurrency(amount: number): string {
	return amount.toLocaleString("en-ZA", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

async function ensureFolder(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path);
	if (!(await app.vault.adapter.exists(normalized))) {
		await app.vault.createFolder(normalized);
	}
}

function buildFrontmatter(obj: Record<string, unknown>): string {
	const lines = ["---"];
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined || v === null || v === "") continue;
		lines.push(k + ": " + JSON.stringify(v));
	}
	lines.push("---", "");
	return lines.join("\n");
}

async function parseFrontmatter(
	app: App,
	file: TFile
): Promise<Record<string, unknown>> {
	const cache = app.metadataCache.getFileCache(file);
	if (cache?.frontmatter) return cache.frontmatter as Record<string, unknown>;
	const raw = await app.vault.read(file);
	const m = raw.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return {};
	const result: Record<string, unknown> = {};
	for (const line of m[1].split("\n")) {
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const key = line.slice(0, colon).trim();
		const val = line.slice(colon + 1).trim();
		try {
			result[key] = JSON.parse(val);
		} catch {
			result[key] = val;
		}
	}
	return result;
}

async function updateFrontmatterField(
	app: App,
	file: TFile,
	key: string,
	value: unknown
): Promise<void> {
	const content = await app.vault.read(file);
	const match = content.match(/^(---\n[\s\S]*?\n---)/);
	if (!match) return;
	const fmBlock = match[1];
	const cleaned = fmBlock
		.replace(new RegExp("^" + key + ":.*$", "m"), "")
		.replace(/\n{2,}/g, "\n");
	const newFm = cleaned.replace(
		/\n---$/,
		"\n" + key + ": " + JSON.stringify(value) + "\n---"
	);
	await app.vault.modify(file, content.replace(match[1], newFm));
}

// ─── Modals ──────────────────────────────────────────────────────────────────

class NewClientModal extends Modal {
	private plugin: FreelanceManagerPlugin;
	private name = "";
	private company = "";
	private email = "";
	private phone = "";
	private notes = "";

	constructor(app: App, plugin: FreelanceManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("fm-modal");
		contentEl.createEl("h2", { text: "New Client" });

		new Setting(contentEl).setName("Name").addText((t) => {
			t.setPlaceholder("e.g. Jane Smith");
			t.onChange((v) => (this.name = v.trim()));
		});

		new Setting(contentEl).setName("Company").addText((t) => {
			t.setPlaceholder("e.g. Acme Corp");
			t.onChange((v) => (this.company = v.trim()));
		});

		new Setting(contentEl).setName("Email").addText((t) => {
			t.setPlaceholder("jane@acme.com");
			t.onChange((v) => (this.email = v.trim()));
		});

		new Setting(contentEl).setName("Phone").addText((t) => {
			t.setPlaceholder("+27 82 000 0000");
			t.onChange((v) => (this.phone = v.trim()));
		});

		new Setting(contentEl).setName("Notes").addTextArea((ta) => {
			ta.setPlaceholder("How you met, context, preferences...");
			ta.onChange((v) => (this.notes = v));
			ta.inputEl.rows = 3;
		});

		const btnRow = contentEl.createDiv({ cls: "setting-item" });
		const btn = btnRow.createEl("button", {
			text: "Save Client",
			cls: "fm-btn-primary",
		});
		btn.onclick = () => this.submit();
	}

	private async submit() {
		if (!this.name) {
			new Notice("Client name is required.");
			return;
		}
		await this.plugin.createClient({
			name: this.name,
			company: this.company,
			email: this.email,
			phone: this.phone,
			notes: this.notes,
		});
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class NewProjectModal extends Modal {
	private plugin: FreelanceManagerPlugin;
	private clientName = "";
	private projectName = "";
	private rateType: RateType = "hourly";
	private rateAmount = 0;
	private startDate = today();
	private deadline = "";
	private status: ProjectStatus = "active";

	constructor(app: App, plugin: FreelanceManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.addClass("fm-modal");
		contentEl.createEl("h2", { text: "New Project" });

		const clients = await this.plugin.getClientNames();

		new Setting(contentEl).setName("Client").addDropdown((d) => {
			if (clients.length === 0) {
				d.addOption("", "— no clients found —");
			} else {
				clients.forEach((c) => d.addOption(c, c));
				this.clientName = clients[0];
			}
			d.onChange((v) => (this.clientName = v));
		});

		new Setting(contentEl).setName("Project name").addText((t) => {
			t.setPlaceholder("e.g. Brand Identity Redesign");
			t.onChange((v) => (this.projectName = v.trim()));
		});

		new Setting(contentEl).setName("Rate type").addDropdown((d) => {
			d.addOption("hourly", "Hourly");
			d.addOption("fixed", "Fixed price");
			d.setValue("hourly");
			d.onChange((v) => (this.rateType = v as RateType));
		});

		new Setting(contentEl).setName("Rate amount (R)").addText((t) => {
			t.setPlaceholder("e.g. 850");
			t.onChange((v) => (this.rateAmount = parseFloat(v) || 0));
		});

		new Setting(contentEl).setName("Start date (YYYY-MM-DD)").addText((t) => {
			t.setValue(today());
			t.onChange((v) => (this.startDate = v.trim()));
		});

		new Setting(contentEl)
			.setName("Deadline (YYYY-MM-DD)")
			.addText((t) => {
				t.setPlaceholder("Optional");
				t.onChange((v) => (this.deadline = v.trim()));
			});

		new Setting(contentEl).setName("Status").addDropdown((d) => {
			d.addOption("active", "Active");
			d.addOption("paused", "Paused");
			d.addOption("complete", "Complete");
			d.setValue("active");
			d.onChange((v) => (this.status = v as ProjectStatus));
		});

		const btnRow = contentEl.createDiv({ cls: "setting-item" });
		const btn = btnRow.createEl("button", {
			text: "Create Project",
			cls: "fm-btn-primary",
		});
		btn.onclick = () => this.submit();
	}

	private async submit() {
		if (!this.projectName) {
			new Notice("Project name is required.");
			return;
		}
		await this.plugin.createProject({
			client: this.clientName,
			name: this.projectName,
			rateType: this.rateType,
			rateAmount: this.rateAmount,
			startDate: this.startDate,
			deadline: this.deadline,
			status: this.status,
		});
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class LogTimeModal extends Modal {
	private plugin: FreelanceManagerPlugin;
	private projectName = "";
	private hours = 0;
	private date = today();
	private description = "";

	constructor(app: App, plugin: FreelanceManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.addClass("fm-modal");
		contentEl.createEl("h2", { text: "Log Time" });

		const projects = await this.plugin.getActiveProjectNames();

		new Setting(contentEl).setName("Project").addDropdown((d) => {
			if (projects.length === 0) {
				d.addOption("", "— no active projects —");
			} else {
				projects.forEach((p) => d.addOption(p, p));
				this.projectName = projects[0];
			}
			d.onChange((v) => (this.projectName = v));
		});

		new Setting(contentEl).setName("Hours").addText((t) => {
			t.setPlaceholder("e.g. 2.5");
			t.onChange((v) => (this.hours = parseFloat(v) || 0));
		});

		new Setting(contentEl).setName("Date (YYYY-MM-DD)").addText((t) => {
			t.setValue(today());
			t.onChange((v) => (this.date = v.trim()));
		});

		new Setting(contentEl).setName("Description of work").addTextArea((ta) => {
			ta.setPlaceholder("What did you work on?");
			ta.onChange((v) => (this.description = v));
			ta.inputEl.rows = 3;
		});

		const btnRow = contentEl.createDiv({ cls: "setting-item" });
		const btn = btnRow.createEl("button", {
			text: "Log Time",
			cls: "fm-btn-primary",
		});
		btn.onclick = () => this.submit();
	}

	private async submit() {
		if (!this.projectName) {
			new Notice("No project selected.");
			return;
		}
		if (this.hours <= 0) {
			new Notice("Hours must be greater than 0.");
			return;
		}
		await this.plugin.logTime({
			project: this.projectName,
			hours: this.hours,
			date: this.date || today(),
			description: this.description,
		});
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class GenerateInvoiceModal extends Modal {
	private plugin: FreelanceManagerPlugin;
	private projectName = "";
	private paymentDays = 30;
	private invoiceNumber = "";

	constructor(app: App, plugin: FreelanceManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.addClass("fm-modal");
		contentEl.createEl("h2", { text: "Generate Invoice" });

		const projects = await this.plugin.getActiveProjectNames();
		const nextNum = await this.plugin.getNextInvoiceNumber();
		this.invoiceNumber = nextNum;

		new Setting(contentEl).setName("Project").addDropdown((d) => {
			if (projects.length === 0) {
				d.addOption("", "— no active projects —");
			} else {
				projects.forEach((p) => d.addOption(p, p));
				this.projectName = projects[0];
			}
			d.onChange((v) => (this.projectName = v));
		});

		new Setting(contentEl).setName("Invoice number").addText((t) => {
			t.setValue(nextNum);
			t.onChange((v) => (this.invoiceNumber = v.trim()));
		});

		new Setting(contentEl)
			.setName("Payment due in (days)")
			.addText((t) => {
				t.setValue("30");
				t.onChange((v) => (this.paymentDays = parseInt(v) || 30));
			});

		const btnRow = contentEl.createDiv({ cls: "setting-item" });
		const btn = btnRow.createEl("button", {
			text: "Generate Invoice",
			cls: "fm-btn-primary",
		});
		btn.onclick = () => this.submit();
	}

	private async submit() {
		if (!this.projectName) {
			new Notice("No project selected.");
			return;
		}
		await this.plugin.generateInvoice(
			this.projectName,
			this.invoiceNumber,
			this.paymentDays
		);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ─── Sidebar / Dashboard View ─────────────────────────────────────────────────

interface ProjectDashboardData {
	file: TFile;
	name: string;
	client: string;
	rateType: RateType;
	rateAmount: number;
	status: ProjectStatus;
	totalHours: number;
	estimatedEarnings: number;
}

class FreelanceDashboardView extends ItemView {
	private plugin: FreelanceManagerPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: FreelanceManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return FM_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Freelance Manager";
	}

	getIcon(): string {
		return "dollar-sign";
	}

	async onOpen() {
		await this.render();
	}

	async render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("fm-sidebar");

		const header = container.createDiv({ cls: "fm-sidebar-header" });
		header.createEl("h2", { text: "Freelance" });
		const refreshBtn = header.createEl("button", {
			cls: "fm-btn-icon",
			attr: { title: "Refresh" },
			text: "↻",
		});
		refreshBtn.onclick = () => this.render();

		const projects = await this.plugin.getDashboardData();
		const activeProjects = projects.filter((p) => p.status === "active");

		container.createDiv({ cls: "fm-section-title", text: "Active Projects" });

		const list = container.createDiv({ cls: "fm-project-list" });

		if (activeProjects.length === 0) {
			list.createDiv({ cls: "fm-empty", text: "No active projects" });
		} else {
			let totalHours = 0;
			let totalEarnings = 0;

			for (const p of activeProjects) {
				totalHours += p.totalHours;
				totalEarnings += p.estimatedEarnings;

				const card = list.createDiv({ cls: "fm-project-card" });
				card.onclick = () =>
					this.app.workspace.openLinkText(p.file.path, "", false);

				const top = card.createDiv({ cls: "fm-project-card-top" });
				top.createDiv({ cls: "fm-project-name", text: p.name });

				const rateLabel =
					p.rateType === "hourly"
						? "R" + formatCurrency(p.rateAmount) + "/hr"
						: "Fixed";
				top.createSpan({ cls: "fm-rate-badge", text: rateLabel });

				if (p.client) {
					card.createDiv({ cls: "fm-project-client", text: p.client });
				}

				const stats = card.createDiv({ cls: "fm-project-stats" });

				const hoursEl = stats.createDiv({ cls: "fm-stat" });
				hoursEl.createSpan({
					cls: "fm-stat-label",
					text: "Hours: ",
				});
				hoursEl.createSpan({ text: p.totalHours.toFixed(1) });

				const earningsEl = stats.createDiv({ cls: "fm-stat" });
				earningsEl.createSpan({
					cls: "fm-stat-label",
					text: "Earned: ",
				});
				earningsEl.createSpan({
					text: "R" + formatCurrency(p.estimatedEarnings),
				});
			}

			// Totals row
			const totals = list.createDiv({ cls: "fm-total-row" });
			totals.createSpan({ text: "Total" });
			const totalsRight = totals.createSpan();
			totalsRight.innerHTML =
				totalHours.toFixed(1) +
				" hrs &nbsp;|&nbsp; <strong>R" +
				formatCurrency(totalEarnings) +
				"</strong>";
		}
	}

	async onClose() {
		// nothing
	}
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class FreelanceSettingTab extends PluginSettingTab {
	private plugin: FreelanceManagerPlugin;

	constructor(app: App, plugin: FreelanceManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Freelance Manager Settings" });

		new Setting(containerEl)
			.setName("Clients folder")
			.setDesc("Where client notes are stored.")
			.addText((t) => {
				t.setPlaceholder("Freelance/Clients");
				t.setValue(this.plugin.settings.clientsFolder);
				t.onChange(async (v) => {
					this.plugin.settings.clientsFolder =
						v.trim() || "Freelance/Clients";
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Projects folder")
			.setDesc("Where project notes are stored.")
			.addText((t) => {
				t.setPlaceholder("Freelance/Projects");
				t.setValue(this.plugin.settings.projectsFolder);
				t.onChange(async (v) => {
					this.plugin.settings.projectsFolder =
						v.trim() || "Freelance/Projects";
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Invoices folder")
			.setDesc("Where invoice notes are stored.")
			.addText((t) => {
				t.setPlaceholder("Freelance/Invoices");
				t.setValue(this.plugin.settings.invoicesFolder);
				t.onChange(async (v) => {
					this.plugin.settings.invoicesFolder =
						v.trim() || "Freelance/Invoices";
					await this.plugin.saveSettings();
				});
			});
	}
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class FreelanceManagerPlugin extends Plugin {
	settings!: FreelanceSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			FM_VIEW_TYPE,
			(leaf) => new FreelanceDashboardView(leaf, this)
		);

		this.addRibbonIcon("dollar-sign", "Freelance Manager", () => {
			this.activateSidebar();
		});

		this.addCommand({
			id: "new-client",
			name: "New Client",
			callback: () => new NewClientModal(this.app, this).open(),
		});

		this.addCommand({
			id: "new-project",
			name: "New Project",
			callback: () => new NewProjectModal(this.app, this).open(),
		});

		this.addCommand({
			id: "log-time",
			name: "Log Time",
			callback: () => new LogTimeModal(this.app, this).open(),
		});

		this.addCommand({
			id: "generate-invoice",
			name: "Generate Invoice",
			callback: () => new GenerateInvoiceModal(this.app, this).open(),
		});

		this.addCommand({
			id: "open-dashboard",
			name: "Open Freelance Dashboard",
			callback: () => this.activateSidebar(),
		});

		this.addSettingTab(new FreelanceSettingTab(this.app, this));

		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.refreshSidebarIfOpen();
			})
		);
	}

	async onunload() {
		this.app.workspace.detachLeavesOfType(FM_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async activateSidebar() {
		const existing = this.app.workspace.getLeavesOfType(FM_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: FM_VIEW_TYPE, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	private refreshSidebarIfOpen() {
		const leaves = this.app.workspace.getLeavesOfType(FM_VIEW_TYPE);
		for (const leaf of leaves) {
			(leaf.view as FreelanceDashboardView).render();
		}
	}

	// ── Data operations ──────────────────────────────────────────────────────

	async createClient(opts: {
		name: string;
		company: string;
		email: string;
		phone: string;
		notes: string;
	}) {
		await ensureFolder(this.app, this.settings.clientsFolder);
		const slug = slugify(opts.name);
		const filePath = normalizePath(
			this.settings.clientsFolder + "/" + slug + ".md"
		);

		if (await this.app.vault.adapter.exists(filePath)) {
			new Notice('Client "' + opts.name + '" already exists.');
			return;
		}

		const fm = buildFrontmatter({
			type: "client",
			name: opts.name,
			company: opts.company || undefined,
			email: opts.email || undefined,
			phone: opts.phone || undefined,
		});

		const content =
			fm +
			"# " + opts.name + "\n\n" +
			(opts.company ? "**Company:** " + opts.company + "\n" : "") +
			(opts.email ? "**Email:** " + opts.email + "\n" : "") +
			(opts.phone ? "**Phone:** " + opts.phone + "\n" : "") +
			"\n## Notes\n\n" + (opts.notes || "") + "\n";

		await this.app.vault.create(filePath, content);
		new Notice('Client "' + opts.name + '" created.');
	}

	async createProject(opts: {
		client: string;
		name: string;
		rateType: RateType;
		rateAmount: number;
		startDate: string;
		deadline: string;
		status: ProjectStatus;
	}) {
		await ensureFolder(this.app, this.settings.projectsFolder);
		const slug = slugify(opts.name);
		const filePath = normalizePath(
			this.settings.projectsFolder + "/" + slug + ".md"
		);

		if (await this.app.vault.adapter.exists(filePath)) {
			new Notice('Project "' + opts.name + '" already exists.');
			return;
		}

		const fm = buildFrontmatter({
			type: "project",
			name: opts.name,
			client: opts.client || undefined,
			rate_type: opts.rateType,
			rate_amount: opts.rateAmount,
			start_date: opts.startDate,
			deadline: opts.deadline || undefined,
			status: opts.status,
			last_invoice_date: undefined,
		});

		const content =
			fm +
			"# " + opts.name + "\n\n" +
			(opts.client ? "**Client:** [[" + opts.client + "]]\n" : "") +
			"**Rate:** " +
			(opts.rateType === "hourly"
				? "R" + opts.rateAmount + "/hr"
				: "Fixed R" + opts.rateAmount) +
			"\n" +
			"**Start:** " + opts.startDate + "\n" +
			(opts.deadline ? "**Deadline:** " + opts.deadline + "\n" : "") +
			"\n## Notes\n\n";

		await this.app.vault.create(filePath, content);
		new Notice('Project "' + opts.name + '" created.');
	}

	async logTime(opts: {
		project: string;
		hours: number;
		date: string;
		description: string;
	}) {
		const logsFolder = normalizePath(
			this.settings.projectsFolder + "/Time Logs"
		);
		await ensureFolder(this.app, logsFolder);

		const slug = slugify(opts.project);
		const ts = opts.date + "-" + Date.now().toString(36);
		const filePath = normalizePath(
			logsFolder + "/" + slug + "-" + ts + ".md"
		);

		const fm = buildFrontmatter({
			type: "time_log",
			project: opts.project,
			date: opts.date,
			hours: opts.hours,
			invoiced: false,
		});

		const content =
			fm +
			"# Time Log – " + opts.project + " (" + opts.date + ")\n\n" +
			"**Project:** [[" + opts.project + "]]\n" +
			"**Date:** " + opts.date + "\n" +
			"**Hours:** " + opts.hours + "\n\n" +
			"## Work Done\n\n" + (opts.description || "") + "\n";

		await this.app.vault.create(filePath, content);
		new Notice(
			opts.hours + " hrs logged for " + opts.project + "."
		);
		this.refreshSidebarIfOpen();
	}

	async generateInvoice(
		projectName: string,
		invoiceNumber: string,
		paymentDays: number
	) {
		// Find the project file to get rate info
		const projectSlug = slugify(projectName);
		const projectPath = normalizePath(
			this.settings.projectsFolder + "/" + projectSlug + ".md"
		);
		const projectFile = this.app.vault.getAbstractFileByPath(projectPath);

		if (!(projectFile instanceof TFile)) {
			new Notice('Project file for "' + projectName + '" not found.');
			return;
		}

		const projectFm = await parseFrontmatter(this.app, projectFile);
		const rateType = (projectFm["rate_type"] as RateType) || "hourly";
		const rateAmount = Number(projectFm["rate_amount"]) || 0;
		const clientName = (projectFm["client"] as string) || "";
		const lastInvoiceDate = (projectFm["last_invoice_date"] as string) || "";

		// Gather uninvoiced time logs for this project
		const logsFolder = normalizePath(
			this.settings.projectsFolder + "/Time Logs"
		);
		const allFiles = this.app.vault.getMarkdownFiles();
		const logFiles = allFiles.filter((f) =>
			f.path.startsWith(logsFolder + "/")
		);

		interface LogEntry {
			file: TFile;
			date: string;
			hours: number;
			description: string;
		}

		const logs: LogEntry[] = [];
		for (const lf of logFiles) {
			const fm = await parseFrontmatter(this.app, lf);
			if (fm["type"] !== "time_log") continue;
			if (fm["project"] !== projectName) continue;
			if (fm["invoiced"] === true) continue;
			// If there is a last invoice date, only include logs after it
			const logDate = (fm["date"] as string) || "";
			if (lastInvoiceDate && logDate <= lastInvoiceDate) continue;

			// Get description from file body
			const raw = await this.app.vault.read(lf);
			const bodyMatch = raw.match(/## Work Done\n\n([\s\S]*?)(\n##|$)/);
			const desc = bodyMatch ? bodyMatch[1].trim() : "";

			logs.push({
				file: lf,
				date: logDate,
				hours: Number(fm["hours"]) || 0,
				description: desc,
			});
		}

		logs.sort((a, b) => a.date.localeCompare(b.date));

		const dt = today();
		const dueDate = addDays(dt, paymentDays);

		let total = 0;
		let tableRows = "";

		if (rateType === "hourly") {
			for (const log of logs) {
				const lineTotal = log.hours * rateAmount;
				total += lineTotal;
				tableRows +=
					"| " + fmtDate(log.date) +
					" | " + log.description.split("\n")[0].substring(0, 60) +
					" | " + log.hours.toFixed(1) +
					" | R" + formatCurrency(rateAmount) +
					" | R" + formatCurrency(lineTotal) + " |\n";
			}
		} else {
			// Fixed price — single line
			total = rateAmount;
			tableRows =
				"| " + fmtDate(dt) +
				" | " + projectName +
				" | — | Fixed | R" + formatCurrency(rateAmount) + " |\n";
		}

		if (logs.length === 0 && rateType === "hourly") {
			new Notice("No uninvoiced time logs found for " + projectName + ".");
			return;
		}

		await ensureFolder(this.app, this.settings.invoicesFolder);
		const invoiceSlug = "INV-" + invoiceNumber + "-" + slugify(projectName);
		const invoicePath = normalizePath(
			this.settings.invoicesFolder + "/" + invoiceSlug + ".md"
		);

		const fm = buildFrontmatter({
			type: "invoice",
			invoice_number: invoiceNumber,
			project: projectName,
			client: clientName || undefined,
			date_issued: dt,
			date_due: dueDate,
			total: total,
			status: "unpaid",
		});

		const tableHeader =
			"| Date | Description | Hours | Rate | Amount |\n" +
			"|------|-------------|-------|------|--------|\n";

		const content =
			fm +
			"# Invoice " + invoiceNumber + "\n\n" +
			"**Project:** [[" + projectSlug + "]]\n" +
			(clientName ? "**Client:** [[" + slugify(clientName) + "]]\n" : "") +
			"**Date Issued:** " + fmtDate(dt) + "\n" +
			"**Payment Due:** " + fmtDate(dueDate) + " (" + paymentDays + " days)\n\n" +
			"---\n\n" +
			"## Line Items\n\n" +
			tableHeader +
			tableRows +
			"\n**Total: R" + formatCurrency(total) + "**\n\n" +
			"---\n\n" +
			"## Payment Details\n\n" +
			"_Add your banking details here._\n";

		await this.app.vault.create(invoicePath, content);

		// Mark logs as invoiced
		for (const log of logs) {
			await updateFrontmatterField(this.app, log.file, "invoiced", true);
		}

		// Update project's last_invoice_date
		await updateFrontmatterField(
			this.app,
			projectFile,
			"last_invoice_date",
			dt
		);

		// Open the new invoice
		const invoiceFile = this.app.vault.getAbstractFileByPath(invoicePath);
		if (invoiceFile instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(invoiceFile);
		}

		new Notice(
			"Invoice " + invoiceNumber + " generated — R" + formatCurrency(total) + " total."
		);
	}

	async getNextInvoiceNumber(): Promise<string> {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(this.settings.invoicesFolder + "/"));

		let maxNum = 0;
		for (const f of files) {
			const fm = await parseFrontmatter(this.app, f);
			if (fm["type"] === "invoice") {
				const num = parseInt(
					String(fm["invoice_number"]).replace(/\D/g, "")
				);
				if (!isNaN(num) && num > maxNum) maxNum = num;
			}
		}
		return String(maxNum + 1).padStart(4, "0");
	}

	async getClientNames(): Promise<string[]> {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) =>
				f.path.startsWith(this.settings.clientsFolder + "/")
			);
		const names: string[] = [];
		for (const f of files) {
			const fm = await parseFrontmatter(this.app, f);
			if (fm["type"] === "client") {
				names.push((fm["name"] as string) || f.basename);
			}
		}
		return names.sort();
	}

	async getActiveProjectNames(): Promise<string[]> {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) =>
				f.path.startsWith(this.settings.projectsFolder + "/") &&
				!f.path.includes("/Time Logs/")
			);
		const names: string[] = [];
		for (const f of files) {
			const fm = await parseFrontmatter(this.app, f);
			if (fm["type"] === "project") {
				names.push((fm["name"] as string) || f.basename);
			}
		}
		return names.sort();
	}

	async getDashboardData(): Promise<ProjectDashboardData[]> {
		const projectFolder = this.settings.projectsFolder;
		const logsFolder = normalizePath(projectFolder + "/Time Logs");
		const allFiles = this.app.vault.getMarkdownFiles();

		const projectFiles = allFiles.filter(
			(f) =>
				f.path.startsWith(projectFolder + "/") &&
				!f.path.includes("/Time Logs/")
		);

		// Aggregate hours per project from time logs
		const logFiles = allFiles.filter((f) =>
			f.path.startsWith(logsFolder + "/")
		);

		const hoursPerProject: Record<string, number> = {};
		for (const lf of logFiles) {
			const fm = await parseFrontmatter(this.app, lf);
			if (fm["type"] !== "time_log") continue;
			const proj = (fm["project"] as string) || "";
			const hrs = Number(fm["hours"]) || 0;
			hoursPerProject[proj] = (hoursPerProject[proj] || 0) + hrs;
		}

		const result: ProjectDashboardData[] = [];
		for (const f of projectFiles) {
			const fm = await parseFrontmatter(this.app, f);
			if (fm["type"] !== "project") continue;

			const name = (fm["name"] as string) || f.basename;
			const rateType = (fm["rate_type"] as RateType) || "hourly";
			const rateAmount = Number(fm["rate_amount"]) || 0;
			const totalHours = hoursPerProject[name] || 0;

			let estimatedEarnings = 0;
			if (rateType === "hourly") {
				estimatedEarnings = totalHours * rateAmount;
			} else {
				estimatedEarnings = rateAmount;
			}

			result.push({
				file: f,
				name,
				client: (fm["client"] as string) || "",
				rateType,
				rateAmount,
				status: (fm["status"] as ProjectStatus) || "active",
				totalHours,
				estimatedEarnings,
			});
		}

		return result.sort((a, b) => a.name.localeCompare(b.name));
	}
}
