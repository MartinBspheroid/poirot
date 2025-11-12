const vscode = require('vscode');
const { LocaleService } = require('../locale/service');
const { TranslationService } = require('../translation/service');
const { ProjectService } = require('../project/service');

/**
 * Tree data provider for translation keys
 */
class TranslationKeysProvider {
    constructor(sidebarService) {
        this.sidebarService = sidebarService;
        this.localeService = new LocaleService();
        this.translationService = new TranslationService();
        this.projectService = new ProjectService();
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.translationData = [];
        this.currentFilePath = null;
        this.clearTimeout = null;
        this.refreshInProgress = false;
        this.pendingRefresh = null;
        // Preloaded data to avoid async in getChildren()
        this.currentTranslations = null;
        this.currentLocale = null;
        this.activeProjectPath = null;
    }

    /**
     * Set the tree view instance for title updates
     * @param {vscode.TreeView} treeView The tree view instance
     */
    setTreeView(treeView) {
        this.treeView = treeView;
    }

    /**
     * Update the tree view title based on current context
     */
    updateTitle() {
        if (!this.treeView) return;

        if (this.currentFilePath && this.translationData.length > 0) {
            const path = require('path');
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this.currentFilePath));
            let displayPath = this.currentFilePath;

            if (workspaceFolder) {
                displayPath = path.relative(workspaceFolder.uri.fsPath, this.currentFilePath);
            }

            // Truncate to last 4 path segments if longer
            const pathSegments = displayPath.split(path.sep).filter(s => s);
            if (pathSegments.length > 4) {
                displayPath = '.../' + pathSegments.slice(-4).join('/');
            } else {
                // Ensure path starts with / for consistent display
                if (!displayPath.startsWith('/')) {
                    displayPath = '/' + displayPath;
                }
            }

            const keyCount = this.translationData.length;
            this.treeView.title = `${displayPath} (${keyCount} ${keyCount === 1 ? 'key' : 'keys'})`;
        } else {
            this.treeView.title = 'Translation Keys';
        }
    }

    /**
     * Refresh the tree view
     * @param {vscode.TextDocument} document The current document
     * @param {boolean} force Force refresh even if it's a translation file
     */
    async refresh(document, force = false) {
        // Prevent concurrent refresh calls
        if (this.refreshInProgress) {
            this.pendingRefresh = { document, force };
            return;
        }

        this.refreshInProgress = true;

        try {
            // Cancel any pending clear operation
            if (this.clearTimeout) {
                clearTimeout(this.clearTimeout);
                this.clearTimeout = null;
            }

            if (document) {
                const isTransFile = await this.sidebarService.isTranslationFile(document);

                // Don't update sidebar if we're viewing a translation file (unless forced)
                // This preserves context when navigating to translation files
                if (!force && isTransFile) {
                    // Still fire the event to refresh the UI with preserved context
                    this._onDidChangeTreeData.fire();
                    this.updateTitle(); // Update title even when preserving context
                    return; // Keep current context
                }

                // Get translation call data
                const translationData = await this.sidebarService.getTranslationData(document);

                // Preload current locale translations
                const currentLocale = this.localeService.getCurrentLocale();
                const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

                if (workspacePath) {
                    const projectPath = this.projectService.getActiveProjectPath(workspacePath);
                    const currentTranslations = await this.translationService.loadTranslationsForLocale(projectPath, currentLocale);

                    // Atomically update all state together
                    this.activeProjectPath = projectPath;
                    this.currentTranslations = currentTranslations;
                    this.currentLocale = currentLocale;
                }

                this.translationData = translationData;
                this.currentFilePath = document.uri.fsPath;
            } else {
                // Debounce clearing to handle rapid editor switches
                this.clearTimeout = setTimeout(() => {
                    this.translationData = [];
                    this.currentFilePath = null;
                    this.currentTranslations = null;
                    this.currentLocale = null;
                    this._onDidChangeTreeData.fire();
                    this.updateTitle();
                    this.clearTimeout = null;
                }, 150);
                return; // Don't fire the event now, wait for timeout or cancellation
            }

            this._onDidChangeTreeData.fire();
            this.updateTitle();
        } finally {
            this.refreshInProgress = false;

            // Process pending refresh if any
            if (this.pendingRefresh) {
                const pending = this.pendingRefresh;
                this.pendingRefresh = null;
                await this.refresh(pending.document, pending.force);
            }
        }
    }

    /**
     * Get tree item for display
     * @param {vscode.TreeItem} element The tree element
     * @returns {vscode.TreeItem} The tree item
     */
    getTreeItem(element) {
        return element;
    }

    /**
     * Get children for a tree element (synchronous, uses preloaded data)
     * @param {vscode.TreeItem} element The parent element
     * @returns {vscode.TreeItem[]} The children
     */
    getChildren(element) {
        if (!element) {
            // Root level - return translation keys directly
            return this.translationData.map(keyData => {
                let currentValue = null;
                if (this.currentTranslations) {
                    currentValue = this.translationService.getTranslation(this.currentTranslations, keyData.key);
                }

                return new TranslationKeyNode(keyData.key, keyData.locales.length, currentValue);
            });
        }

        if (element instanceof TranslationKeyNode) {
            // Return locale items for this key
            const keyData = this.translationData.find(data => data.key === element.key);
            if (keyData) {
                return keyData.locales.map(localeData =>
                    new TranslationItemNode(
                        localeData.locale,
                        localeData.value,
                        element.key,
                        localeData.workspacePath
                    )
                );
            }
        }

        return [];
    }
}

/**
 * Tree node for translation keys
 */
class TranslationKeyNode extends vscode.TreeItem {
    constructor(key, localeCount, currentValue = null) {
        super(key, vscode.TreeItemCollapsibleState.Collapsed);
        this.key = key;

        if (currentValue) {
            // Truncate long values for display
            const displayValue = currentValue.length > 40 ? currentValue.substring(0, 37) + '...' : currentValue;
            this.description = `"${displayValue}" • ${localeCount} ${localeCount === 1 ? 'locale' : 'locales'}`;
        } else {
            this.description = `(no value) • ${localeCount} ${localeCount === 1 ? 'locale' : 'locales'}`;
        }

        this.contextValue = 'translationKey';
        // No icon for cleaner look
    }
}

/**
 * Tree node for individual translation items (locale + value)
 */
class TranslationItemNode extends vscode.TreeItem {
    constructor(locale, value, key, workspacePath) {
        // Truncate long values for display
        const displayValue = value.length > 50 ? value.substring(0, 47) + '...' : value;
        const label = `[${locale}] "${displayValue}"`;

        super(label, vscode.TreeItemCollapsibleState.None);

        this.locale = locale;
        this.value = value;
        this.key = key;
        this.workspacePath = workspacePath;
        this.contextValue = 'translationItem';

        // Add command for clicking behavior with clearer indication
        this.command = {
            command: 'elementaryWatson.openTranslationFile',
            title: 'Navigate to translation',
            arguments: [this.workspacePath, this.locale, this.key]
        };

        // Show empty values differently
        if (!value || value.trim() === '') {
            this.description = '(empty)';
        }
    }
}

module.exports = { TranslationKeysProvider, TranslationKeyNode, TranslationItemNode };
