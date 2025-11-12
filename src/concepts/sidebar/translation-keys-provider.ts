import * as vscode from 'vscode';
import * as path from 'path';
import { LocaleService } from '../locale/service';
import { TranslationService } from '../translation/service';
import { ProjectService } from '../project/service';
import { SidebarService } from './service';

type LocaleData = {
  locale: string;
  value: string;
  workspacePath: string;
};

type TranslationKeyData = {
  key: string;
  locales: LocaleData[];
};

type PendingRefresh = {
  document: vscode.TextDocument | null;
  force: boolean;
};

/**
 * Tree node for translation keys
 */
class TranslationKeyNode extends vscode.TreeItem {
  key: string;

  constructor(key: string, localeCount: number, currentValue: string | null = null) {
    super(key, vscode.TreeItemCollapsibleState.Collapsed);
    this.key = key;

    if (currentValue) {
      // Truncate long values for display
      const displayValue =
        currentValue.length > 40 ? currentValue.substring(0, 37) + '...' : currentValue;
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
  locale: string;
  value: string;
  key: string;
  workspacePath: string;

  constructor(locale: string, value: string, key: string, workspacePath: string) {
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
      command: 'poirot.openTranslationFile',
      title: 'Navigate to translation',
      arguments: [this.workspacePath, this.locale, this.key],
    };

    // Show empty values differently
    if (!value || value.trim() === '') {
      this.description = '(empty)';
    }
  }
}

/**
 * Tree data provider for translation keys
 */
export class TranslationKeysProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private sidebarService: SidebarService;
  private localeService: LocaleService;
  private translationService: TranslationService;
  private projectService: ProjectService;
  private _onDidChangeTreeData: vscode.EventEmitter<void>;
  public onDidChangeTreeData: vscode.Event<void>;
  public translationData: TranslationKeyData[];
  public currentFilePath: string | null;
  private clearTimeout: NodeJS.Timeout | null;
  private refreshInProgress: boolean;
  private pendingRefresh: PendingRefresh | null;
  private currentTranslations: Record<string, unknown> | null;
  private currentLocale: string | null;
  private activeProjectPath: string | null;
  private treeView: vscode.TreeView<vscode.TreeItem> | null;

  constructor(sidebarService: SidebarService) {
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
    this.treeView = null;
  }

  /**
   * Set the tree view instance for title updates
   * @param treeView The tree view instance
   */
  setTreeView(treeView: vscode.TreeView<vscode.TreeItem>): void {
    this.treeView = treeView;
  }

  /**
   * Update the tree view title based on current context
   */
  updateTitle(): void {
    if (!this.treeView) return;

    if (this.currentFilePath && this.translationData.length > 0) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(this.currentFilePath)
      );
      let displayPath = this.currentFilePath;

      if (workspaceFolder) {
        displayPath = path.relative(workspaceFolder.uri.fsPath, this.currentFilePath);
      }

      // Truncate to last 4 path segments if longer
      const pathSegments = displayPath.split(path.sep).filter((s) => s);
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
   * @param document The current document
   * @param force Force refresh even if it's a translation file
   */
  async refresh(document: vscode.TextDocument | null, force = false): Promise<void> {
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
          const currentTranslations = await this.translationService.loadTranslationsForLocale(
            projectPath,
            currentLocale
          );

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
   * @param element The tree element
   * @returns The tree item
   */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children for a tree element (synchronous, uses preloaded data)
   * @param element The parent element
   * @returns The children
   */
  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Root level - return translation keys directly
      return this.translationData.map((keyData) => {
        let currentValue: string | null = null;
        if (this.currentTranslations) {
          currentValue = this.translationService.getTranslation(
            this.currentTranslations,
            keyData.key
          );
        }

        return new TranslationKeyNode(keyData.key, keyData.locales.length, currentValue);
      });
    }

    if (element instanceof TranslationKeyNode) {
      // Return locale items for this key
      const keyData = this.translationData.find((data) => data.key === element.key);
      if (keyData) {
        return keyData.locales.map(
          (localeData) =>
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

export { TranslationKeyNode, TranslationItemNode };
