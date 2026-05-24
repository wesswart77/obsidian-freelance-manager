var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => FreelanceManagerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  clientsFolder: "Freelance/Clients",
  projectsFolder: "Freelance/Projects",
  invoicesFolder: "Freelance/Invoices"
};
var FM_VIEW_TYPE = "fm-dashboard-view";
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function today() {
  return new Date().toISOString().split("T")[0];
}
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
function fmtDate(d) {
  if (!d)
    return "";
  const parts = d.split("-");
  if (parts.length < 3)
    return d;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}
function formatCurrency(amount) {
  return amount.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
async function ensureFolder(app, path) {
  const normalized = (0, import_obsidian.normalizePath)(path);
  if (!await app.vault.adapter.exists(normalized)) {
    await app.vault.createFolder(normalized);
  }
}
function buildFrontmatter(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (v === void 0 || v === null || v === "")
      continue;
    lines.push(k + ": " + JSON.stringify(v));
  }
  lines.push("---", "");
  return lines.join("\n");
}
async function parseFrontmatter(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  if (cache == null ? void 0 : cache.frontmatter)
    return cache.frontmatter;
  const raw = await app.vault.read(file);
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m)
    return {};
  const result = {};
  for (const line of m[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0)
      continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    try {
      result[key] = JSON.parse(val);
    } catch (e) {
      result[key] = val;
    }
  }
  return result;
}
async function updateFrontmatterField(app, file, key, value) {
  const content = await app.vault.read(file);
  const match = content.match(/^(---\n[\s\S]*?\n---)/);
  if (!match)
    return;
  const fmBlock = match[1];
  const cleaned = fmBlock.replace(new RegExp("^" + key + ":.*$", "m"), "").replace(/\n{2,}/g, "\n");
  const newFm = cleaned.replace(
    /\n---$/,
    "\n" + key + ": " + JSON.stringify(value) + "\n---"
  );
  await app.vault.modify(file, content.replace(match[1], newFm));
}
var NewClientModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.name = "";
    this.company = "";
    this.email = "";
    this.phone = "";
    this.notes = "";
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("fm-modal");
    contentEl.createEl("h2", { text: "New Client" });
    new import_obsidian.Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("e.g. Jane Smith");
      t.onChange((v) => this.name = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Company").addText((t) => {
      t.setPlaceholder("e.g. Acme Corp");
      t.onChange((v) => this.company = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Email").addText((t) => {
      t.setPlaceholder("jane@acme.com");
      t.onChange((v) => this.email = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Phone").addText((t) => {
      t.setPlaceholder("+27 82 000 0000");
      t.onChange((v) => this.phone = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Notes").addTextArea((ta) => {
      ta.setPlaceholder("How you met, context, preferences...");
      ta.onChange((v) => this.notes = v);
      ta.inputEl.rows = 3;
    });
    const btnRow = contentEl.createDiv({ cls: "setting-item" });
    const btn = btnRow.createEl("button", {
      text: "Save Client",
      cls: "fm-btn-primary"
    });
    btn.onclick = () => this.submit();
  }
  async submit() {
    if (!this.name) {
      new import_obsidian.Notice("Client name is required.");
      return;
    }
    await this.plugin.createClient({
      name: this.name,
      company: this.company,
      email: this.email,
      phone: this.phone,
      notes: this.notes
    });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var NewProjectModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.clientName = "";
    this.projectName = "";
    this.rateType = "hourly";
    this.rateAmount = 0;
    this.startDate = today();
    this.deadline = "";
    this.status = "active";
    this.plugin = plugin;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("fm-modal");
    contentEl.createEl("h2", { text: "New Project" });
    const clients = await this.plugin.getClientNames();
    new import_obsidian.Setting(contentEl).setName("Client").addDropdown((d) => {
      if (clients.length === 0) {
        d.addOption("", "\u2014 no clients found \u2014");
      } else {
        clients.forEach((c) => d.addOption(c, c));
        this.clientName = clients[0];
      }
      d.onChange((v) => this.clientName = v);
    });
    new import_obsidian.Setting(contentEl).setName("Project name").addText((t) => {
      t.setPlaceholder("e.g. Brand Identity Redesign");
      t.onChange((v) => this.projectName = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Rate type").addDropdown((d) => {
      d.addOption("hourly", "Hourly");
      d.addOption("fixed", "Fixed price");
      d.setValue("hourly");
      d.onChange((v) => this.rateType = v);
    });
    new import_obsidian.Setting(contentEl).setName("Rate amount (R)").addText((t) => {
      t.setPlaceholder("e.g. 850");
      t.onChange((v) => this.rateAmount = parseFloat(v) || 0);
    });
    new import_obsidian.Setting(contentEl).setName("Start date (YYYY-MM-DD)").addText((t) => {
      t.setValue(today());
      t.onChange((v) => this.startDate = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Deadline (YYYY-MM-DD)").addText((t) => {
      t.setPlaceholder("Optional");
      t.onChange((v) => this.deadline = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Status").addDropdown((d) => {
      d.addOption("active", "Active");
      d.addOption("paused", "Paused");
      d.addOption("complete", "Complete");
      d.setValue("active");
      d.onChange((v) => this.status = v);
    });
    const btnRow = contentEl.createDiv({ cls: "setting-item" });
    const btn = btnRow.createEl("button", {
      text: "Create Project",
      cls: "fm-btn-primary"
    });
    btn.onclick = () => this.submit();
  }
  async submit() {
    if (!this.projectName) {
      new import_obsidian.Notice("Project name is required.");
      return;
    }
    await this.plugin.createProject({
      client: this.clientName,
      name: this.projectName,
      rateType: this.rateType,
      rateAmount: this.rateAmount,
      startDate: this.startDate,
      deadline: this.deadline,
      status: this.status
    });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var LogTimeModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.projectName = "";
    this.hours = 0;
    this.date = today();
    this.description = "";
    this.plugin = plugin;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("fm-modal");
    contentEl.createEl("h2", { text: "Log Time" });
    const projects = await this.plugin.getActiveProjectNames();
    new import_obsidian.Setting(contentEl).setName("Project").addDropdown((d) => {
      if (projects.length === 0) {
        d.addOption("", "\u2014 no active projects \u2014");
      } else {
        projects.forEach((p) => d.addOption(p, p));
        this.projectName = projects[0];
      }
      d.onChange((v) => this.projectName = v);
    });
    new import_obsidian.Setting(contentEl).setName("Hours").addText((t) => {
      t.setPlaceholder("e.g. 2.5");
      t.onChange((v) => this.hours = parseFloat(v) || 0);
    });
    new import_obsidian.Setting(contentEl).setName("Date (YYYY-MM-DD)").addText((t) => {
      t.setValue(today());
      t.onChange((v) => this.date = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Description of work").addTextArea((ta) => {
      ta.setPlaceholder("What did you work on?");
      ta.onChange((v) => this.description = v);
      ta.inputEl.rows = 3;
    });
    const btnRow = contentEl.createDiv({ cls: "setting-item" });
    const btn = btnRow.createEl("button", {
      text: "Log Time",
      cls: "fm-btn-primary"
    });
    btn.onclick = () => this.submit();
  }
  async submit() {
    if (!this.projectName) {
      new import_obsidian.Notice("No project selected.");
      return;
    }
    if (this.hours <= 0) {
      new import_obsidian.Notice("Hours must be greater than 0.");
      return;
    }
    await this.plugin.logTime({
      project: this.projectName,
      hours: this.hours,
      date: this.date || today(),
      description: this.description
    });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var GenerateInvoiceModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.projectName = "";
    this.paymentDays = 30;
    this.invoiceNumber = "";
    this.plugin = plugin;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("fm-modal");
    contentEl.createEl("h2", { text: "Generate Invoice" });
    const projects = await this.plugin.getActiveProjectNames();
    const nextNum = await this.plugin.getNextInvoiceNumber();
    this.invoiceNumber = nextNum;
    new import_obsidian.Setting(contentEl).setName("Project").addDropdown((d) => {
      if (projects.length === 0) {
        d.addOption("", "\u2014 no active projects \u2014");
      } else {
        projects.forEach((p) => d.addOption(p, p));
        this.projectName = projects[0];
      }
      d.onChange((v) => this.projectName = v);
    });
    new import_obsidian.Setting(contentEl).setName("Invoice number").addText((t) => {
      t.setValue(nextNum);
      t.onChange((v) => this.invoiceNumber = v.trim());
    });
    new import_obsidian.Setting(contentEl).setName("Payment due in (days)").addText((t) => {
      t.setValue("30");
      t.onChange((v) => this.paymentDays = parseInt(v) || 30);
    });
    const btnRow = contentEl.createDiv({ cls: "setting-item" });
    const btn = btnRow.createEl("button", {
      text: "Generate Invoice",
      cls: "fm-btn-primary"
    });
    btn.onclick = () => this.submit();
  }
  async submit() {
    if (!this.projectName) {
      new import_obsidian.Notice("No project selected.");
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
};
var FreelanceDashboardView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return FM_VIEW_TYPE;
  }
  getDisplayText() {
    return "Freelance Manager";
  }
  getIcon() {
    return "dollar-sign";
  }
  async onOpen() {
    await this.render();
  }
  async render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("fm-sidebar");
    const header = container.createDiv({ cls: "fm-sidebar-header" });
    header.createEl("h2", { text: "Freelance" });
    const refreshBtn = header.createEl("button", {
      cls: "fm-btn-icon",
      attr: { title: "Refresh" },
      text: "\u21BB"
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
        card.onclick = () => this.app.workspace.openLinkText(p.file.path, "", false);
        const top = card.createDiv({ cls: "fm-project-card-top" });
        top.createDiv({ cls: "fm-project-name", text: p.name });
        const rateLabel = p.rateType === "hourly" ? "R" + formatCurrency(p.rateAmount) + "/hr" : "Fixed";
        top.createSpan({ cls: "fm-rate-badge", text: rateLabel });
        if (p.client) {
          card.createDiv({ cls: "fm-project-client", text: p.client });
        }
        const stats = card.createDiv({ cls: "fm-project-stats" });
        const hoursEl = stats.createDiv({ cls: "fm-stat" });
        hoursEl.createSpan({
          cls: "fm-stat-label",
          text: "Hours: "
        });
        hoursEl.createSpan({ text: p.totalHours.toFixed(1) });
        const earningsEl = stats.createDiv({ cls: "fm-stat" });
        earningsEl.createSpan({
          cls: "fm-stat-label",
          text: "Earned: "
        });
        earningsEl.createSpan({
          text: "R" + formatCurrency(p.estimatedEarnings)
        });
      }
      const totals = list.createDiv({ cls: "fm-total-row" });
      totals.createSpan({ text: "Total" });
      const totalsRight = totals.createSpan();
      totalsRight.innerHTML = totalHours.toFixed(1) + " hrs &nbsp;|&nbsp; <strong>R" + formatCurrency(totalEarnings) + "</strong>";
    }
  }
  async onClose() {
  }
};
var FreelanceSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Freelance Manager Settings" });
    new import_obsidian.Setting(containerEl).setName("Clients folder").setDesc("Where client notes are stored.").addText((t) => {
      t.setPlaceholder("Freelance/Clients");
      t.setValue(this.plugin.settings.clientsFolder);
      t.onChange(async (v) => {
        this.plugin.settings.clientsFolder = v.trim() || "Freelance/Clients";
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Projects folder").setDesc("Where project notes are stored.").addText((t) => {
      t.setPlaceholder("Freelance/Projects");
      t.setValue(this.plugin.settings.projectsFolder);
      t.onChange(async (v) => {
        this.plugin.settings.projectsFolder = v.trim() || "Freelance/Projects";
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Invoices folder").setDesc("Where invoice notes are stored.").addText((t) => {
      t.setPlaceholder("Freelance/Invoices");
      t.setValue(this.plugin.settings.invoicesFolder);
      t.onChange(async (v) => {
        this.plugin.settings.invoicesFolder = v.trim() || "Freelance/Invoices";
        await this.plugin.saveSettings();
      });
    });
  }
};
var FreelanceManagerPlugin = class extends import_obsidian.Plugin {
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
      callback: () => new NewClientModal(this.app, this).open()
    });
    this.addCommand({
      id: "new-project",
      name: "New Project",
      callback: () => new NewProjectModal(this.app, this).open()
    });
    this.addCommand({
      id: "log-time",
      name: "Log Time",
      callback: () => new LogTimeModal(this.app, this).open()
    });
    this.addCommand({
      id: "generate-invoice",
      name: "Generate Invoice",
      callback: () => new GenerateInvoiceModal(this.app, this).open()
    });
    this.addCommand({
      id: "open-dashboard",
      name: "Open Freelance Dashboard",
      callback: () => this.activateSidebar()
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
  async activateSidebar() {
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
  refreshSidebarIfOpen() {
    const leaves = this.app.workspace.getLeavesOfType(FM_VIEW_TYPE);
    for (const leaf of leaves) {
      leaf.view.render();
    }
  }
  // ── Data operations ──────────────────────────────────────────────────────
  async createClient(opts) {
    await ensureFolder(this.app, this.settings.clientsFolder);
    const slug = slugify(opts.name);
    const filePath = (0, import_obsidian.normalizePath)(
      this.settings.clientsFolder + "/" + slug + ".md"
    );
    if (await this.app.vault.adapter.exists(filePath)) {
      new import_obsidian.Notice('Client "' + opts.name + '" already exists.');
      return;
    }
    const fm = buildFrontmatter({
      type: "client",
      name: opts.name,
      company: opts.company || void 0,
      email: opts.email || void 0,
      phone: opts.phone || void 0
    });
    const content = fm + "# " + opts.name + "\n\n" + (opts.company ? "**Company:** " + opts.company + "\n" : "") + (opts.email ? "**Email:** " + opts.email + "\n" : "") + (opts.phone ? "**Phone:** " + opts.phone + "\n" : "") + "\n## Notes\n\n" + (opts.notes || "") + "\n";
    await this.app.vault.create(filePath, content);
    new import_obsidian.Notice('Client "' + opts.name + '" created.');
  }
  async createProject(opts) {
    await ensureFolder(this.app, this.settings.projectsFolder);
    const slug = slugify(opts.name);
    const filePath = (0, import_obsidian.normalizePath)(
      this.settings.projectsFolder + "/" + slug + ".md"
    );
    if (await this.app.vault.adapter.exists(filePath)) {
      new import_obsidian.Notice('Project "' + opts.name + '" already exists.');
      return;
    }
    const fm = buildFrontmatter({
      type: "project",
      name: opts.name,
      client: opts.client || void 0,
      rate_type: opts.rateType,
      rate_amount: opts.rateAmount,
      start_date: opts.startDate,
      deadline: opts.deadline || void 0,
      status: opts.status,
      last_invoice_date: void 0
    });
    const content = fm + "# " + opts.name + "\n\n" + (opts.client ? "**Client:** [[" + opts.client + "]]\n" : "") + "**Rate:** " + (opts.rateType === "hourly" ? "R" + opts.rateAmount + "/hr" : "Fixed R" + opts.rateAmount) + "\n**Start:** " + opts.startDate + "\n" + (opts.deadline ? "**Deadline:** " + opts.deadline + "\n" : "") + "\n## Notes\n\n";
    await this.app.vault.create(filePath, content);
    new import_obsidian.Notice('Project "' + opts.name + '" created.');
  }
  async logTime(opts) {
    const logsFolder = (0, import_obsidian.normalizePath)(
      this.settings.projectsFolder + "/Time Logs"
    );
    await ensureFolder(this.app, logsFolder);
    const slug = slugify(opts.project);
    const ts = opts.date + "-" + Date.now().toString(36);
    const filePath = (0, import_obsidian.normalizePath)(
      logsFolder + "/" + slug + "-" + ts + ".md"
    );
    const fm = buildFrontmatter({
      type: "time_log",
      project: opts.project,
      date: opts.date,
      hours: opts.hours,
      invoiced: false
    });
    const content = fm + "# Time Log \u2013 " + opts.project + " (" + opts.date + ")\n\n**Project:** [[" + opts.project + "]]\n**Date:** " + opts.date + "\n**Hours:** " + opts.hours + "\n\n## Work Done\n\n" + (opts.description || "") + "\n";
    await this.app.vault.create(filePath, content);
    new import_obsidian.Notice(
      opts.hours + " hrs logged for " + opts.project + "."
    );
    this.refreshSidebarIfOpen();
  }
  async generateInvoice(projectName, invoiceNumber, paymentDays) {
    const projectSlug = slugify(projectName);
    const projectPath = (0, import_obsidian.normalizePath)(
      this.settings.projectsFolder + "/" + projectSlug + ".md"
    );
    const projectFile = this.app.vault.getAbstractFileByPath(projectPath);
    if (!(projectFile instanceof import_obsidian.TFile)) {
      new import_obsidian.Notice('Project file for "' + projectName + '" not found.');
      return;
    }
    const projectFm = await parseFrontmatter(this.app, projectFile);
    const rateType = projectFm["rate_type"] || "hourly";
    const rateAmount = Number(projectFm["rate_amount"]) || 0;
    const clientName = projectFm["client"] || "";
    const lastInvoiceDate = projectFm["last_invoice_date"] || "";
    const logsFolder = (0, import_obsidian.normalizePath)(
      this.settings.projectsFolder + "/Time Logs"
    );
    const allFiles = this.app.vault.getMarkdownFiles();
    const logFiles = allFiles.filter(
      (f) => f.path.startsWith(logsFolder + "/")
    );
    const logs = [];
    for (const lf of logFiles) {
      const fm2 = await parseFrontmatter(this.app, lf);
      if (fm2["type"] !== "time_log")
        continue;
      if (fm2["project"] !== projectName)
        continue;
      if (fm2["invoiced"] === true)
        continue;
      const logDate = fm2["date"] || "";
      if (lastInvoiceDate && logDate <= lastInvoiceDate)
        continue;
      const raw = await this.app.vault.read(lf);
      const bodyMatch = raw.match(/## Work Done\n\n([\s\S]*?)(\n##|$)/);
      const desc = bodyMatch ? bodyMatch[1].trim() : "";
      logs.push({
        file: lf,
        date: logDate,
        hours: Number(fm2["hours"]) || 0,
        description: desc
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
        tableRows += "| " + fmtDate(log.date) + " | " + log.description.split("\n")[0].substring(0, 60) + " | " + log.hours.toFixed(1) + " | R" + formatCurrency(rateAmount) + " | R" + formatCurrency(lineTotal) + " |\n";
      }
    } else {
      total = rateAmount;
      tableRows = "| " + fmtDate(dt) + " | " + projectName + " | \u2014 | Fixed | R" + formatCurrency(rateAmount) + " |\n";
    }
    if (logs.length === 0 && rateType === "hourly") {
      new import_obsidian.Notice("No uninvoiced time logs found for " + projectName + ".");
      return;
    }
    await ensureFolder(this.app, this.settings.invoicesFolder);
    const invoiceSlug = "INV-" + invoiceNumber + "-" + slugify(projectName);
    const invoicePath = (0, import_obsidian.normalizePath)(
      this.settings.invoicesFolder + "/" + invoiceSlug + ".md"
    );
    const fm = buildFrontmatter({
      type: "invoice",
      invoice_number: invoiceNumber,
      project: projectName,
      client: clientName || void 0,
      date_issued: dt,
      date_due: dueDate,
      total,
      status: "unpaid"
    });
    const tableHeader = "| Date | Description | Hours | Rate | Amount |\n|------|-------------|-------|------|--------|\n";
    const content = fm + "# Invoice " + invoiceNumber + "\n\n**Project:** [[" + projectSlug + "]]\n" + (clientName ? "**Client:** [[" + slugify(clientName) + "]]\n" : "") + "**Date Issued:** " + fmtDate(dt) + "\n**Payment Due:** " + fmtDate(dueDate) + " (" + paymentDays + " days)\n\n---\n\n## Line Items\n\n" + tableHeader + tableRows + "\n**Total: R" + formatCurrency(total) + "**\n\n---\n\n## Payment Details\n\n_Add your banking details here._\n";
    await this.app.vault.create(invoicePath, content);
    for (const log of logs) {
      await updateFrontmatterField(this.app, log.file, "invoiced", true);
    }
    await updateFrontmatterField(
      this.app,
      projectFile,
      "last_invoice_date",
      dt
    );
    const invoiceFile = this.app.vault.getAbstractFileByPath(invoicePath);
    if (invoiceFile instanceof import_obsidian.TFile) {
      await this.app.workspace.getLeaf(false).openFile(invoiceFile);
    }
    new import_obsidian.Notice(
      "Invoice " + invoiceNumber + " generated \u2014 R" + formatCurrency(total) + " total."
    );
  }
  async getNextInvoiceNumber() {
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(this.settings.invoicesFolder + "/"));
    let maxNum = 0;
    for (const f of files) {
      const fm = await parseFrontmatter(this.app, f);
      if (fm["type"] === "invoice") {
        const num = parseInt(
          String(fm["invoice_number"]).replace(/\D/g, "")
        );
        if (!isNaN(num) && num > maxNum)
          maxNum = num;
      }
    }
    return String(maxNum + 1).padStart(4, "0");
  }
  async getClientNames() {
    const files = this.app.vault.getMarkdownFiles().filter(
      (f) => f.path.startsWith(this.settings.clientsFolder + "/")
    );
    const names = [];
    for (const f of files) {
      const fm = await parseFrontmatter(this.app, f);
      if (fm["type"] === "client") {
        names.push(fm["name"] || f.basename);
      }
    }
    return names.sort();
  }
  async getActiveProjectNames() {
    const files = this.app.vault.getMarkdownFiles().filter(
      (f) => f.path.startsWith(this.settings.projectsFolder + "/") && !f.path.includes("/Time Logs/")
    );
    const names = [];
    for (const f of files) {
      const fm = await parseFrontmatter(this.app, f);
      if (fm["type"] === "project") {
        names.push(fm["name"] || f.basename);
      }
    }
    return names.sort();
  }
  async getDashboardData() {
    const projectFolder = this.settings.projectsFolder;
    const logsFolder = (0, import_obsidian.normalizePath)(projectFolder + "/Time Logs");
    const allFiles = this.app.vault.getMarkdownFiles();
    const projectFiles = allFiles.filter(
      (f) => f.path.startsWith(projectFolder + "/") && !f.path.includes("/Time Logs/")
    );
    const logFiles = allFiles.filter(
      (f) => f.path.startsWith(logsFolder + "/")
    );
    const hoursPerProject = {};
    for (const lf of logFiles) {
      const fm = await parseFrontmatter(this.app, lf);
      if (fm["type"] !== "time_log")
        continue;
      const proj = fm["project"] || "";
      const hrs = Number(fm["hours"]) || 0;
      hoursPerProject[proj] = (hoursPerProject[proj] || 0) + hrs;
    }
    const result = [];
    for (const f of projectFiles) {
      const fm = await parseFrontmatter(this.app, f);
      if (fm["type"] !== "project")
        continue;
      const name = fm["name"] || f.basename;
      const rateType = fm["rate_type"] || "hourly";
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
        client: fm["client"] || "",
        rateType,
        rateAmount,
        status: fm["status"] || "active",
        totalHours,
        estimatedEarnings
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
};
