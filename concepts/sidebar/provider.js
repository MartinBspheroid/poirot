const vscode = require('vscode');
const { LocaleService } = require('../locale/service');
const { TranslationService } = require('../translation/service');
const { ProjectService } = require('../project/service');

/**
 * Tree data provider for the ElementaryWatson sidebar
 */
class SidebarTreeProvider {
    constructor(sidebarService) {
        this.sidebarService = sidebarService;
        this.localeService = new LocaleService();
        this.translationService = new TranslationService();
        this.projectService = new ProjectService();
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.translationData = [];
        this.currentFilePath = null;
        this.clearTimeout = null; // Debounce clearing to handle editor switching
        this.availableProjects = [];
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
            
            // Ensure path starts with / for consistent display
            if (!displayPath.startsWith('/')) {
                displayPath = '/' + displayPath;
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
        // Cancel any pending clear operation
        if (this.clearTimeout) {
            clearTimeout(this.clearTimeout);
            this.clearTimeout = null;
        }
        
        // Update available projects and active project
        if (vscode.workspace.workspaceFolders?.[0]) {
            const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.availableProjects = await this.projectService.scanForProjects(workspacePath);
            this.activeProjectPath = this.projectService.getActiveProjectPath(workspacePath);
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
            
            this.translationData = await this.sidebarService.getTranslationData(document);
            this.currentFilePath = document.uri.fsPath;
        } else {
            // Debounce clearing to handle rapid editor switches
            this.clearTimeout = setTimeout(() => {
                this.translationData = [];
                this.currentFilePath = null;
                this._onDidChangeTreeData.fire();
                this.updateTitle();
                this.clearTimeout = null;
            }, 150);
            return; // Don't fire the event now, wait for timeout or cancellation
        }
        this._onDidChangeTreeData.fire();
        this.updateTitle();
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
     * Get children for a tree element
     * @param {vscode.TreeItem} element The parent element
     * @returns {Promise<vscode.TreeItem[]>} The children
     */
    async getChildren(element) {
        if (!element) {
            const children = [];
            
            // Add project selection node if multiple projects found
            if (this.availableProjects.length > 1) {
                const activeProjectName = this.activeProjectPath ? 
                    this.projectService.getProjectName(this.activeProjectPath) : 'Workspace Root';
                children.push(new ProjectSelectionNode(activeProjectName, this.availableProjects.length));
            }
            
            // Get current locale and workspace path
            const currentLocale = this.localeService.getCurrentLocale();
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            
            if (!workspaceFolder) {
                children.push(...this.translationData.map(keyData => 
                    new TranslationKeyNode(keyData.key, keyData.locales.length)
                ));
                return children;
            }
            
            const workspacePath = workspaceFolder.uri.fsPath;
            const projectPath = this.activeProjectPath || workspacePath;
            
            // Load current locale translations
            const currentTranslations = await this.translationService.loadTranslationsForLocale(projectPath, currentLocale);
            
            // Return translation keys with current locale values
            children.push(...this.translationData.map(keyData => {
                let currentValue = null;
                if (currentTranslations) {
                    currentValue = this.translationService.getTranslation(currentTranslations, keyData.key);
                }
                
                return new TranslationKeyNode(keyData.key, keyData.locales.length, currentValue);
            }));
            
            return children;
        }

        if (element instanceof ProjectSelectionNode) {
            // Return available projects for selection
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspacePath) return [];
            
            return this.availableProjects.map(project => 
                new ProjectOptionNode(
                    project.name,
                    project.relativePath,
                    project.path === this.activeProjectPath
                )
            );
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

// FileContextNode removed - using proper tree view title instead

/**
 * Tree node for project selection dropdown
 */
class ProjectSelectionNode extends vscode.TreeItem {
    constructor(activeProjectName, projectCount) {
        super(`$(folder-active) ${activeProjectName}`, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = `${projectCount} projects found`;
        this.contextValue = 'projectSelection';
        this.tooltip = 'Click to change active project';
    }
}

/**
 * Tree node for individual project option
 */
class ProjectOptionNode extends vscode.TreeItem {
    constructor(name, relativePath, isActive) {
        const label = isActive ? `$(check) ${name}` : name;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = relativePath;
        this.contextValue = 'projectOption';
        this.tooltip = `Select ${name} as active project`;
        
        if (!isActive) {
            this.command = {
                command: 'elementaryWatson.selectProject',
                title: 'Select Project',
                arguments: [relativePath]
            };
        }
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

        // Show empty values differently and add navigation hint
        if (!value || value.trim() === '') {
            this.description = '(empty) → click to navigate';
        } else {
            this.description = '→ click to navigate';
        }
    }
}

module.exports = { SidebarTreeProvider, TranslationKeyNode, TranslationItemNode, ProjectSelectionNode, ProjectOptionNode }; 