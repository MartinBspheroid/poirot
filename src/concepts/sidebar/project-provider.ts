import * as vscode from 'vscode';
import { ProjectService } from '../project/service';

type Project = {
  path: string;
  name: string;
  relativePath: string;
};

/**
 * Tree node for project selection dropdown
 */
class ProjectSelectionNode extends vscode.TreeItem {
  constructor(activeProjectName: string, projectCount: number) {
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
  constructor(name: string, relativePath: string, isActive: boolean) {
    const label = isActive ? `● ${name}` : name;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = relativePath;
    this.contextValue = 'projectOption';
    this.tooltip = `Select ${name} as active project`;

    if (!isActive) {
      this.command = {
        command: 'poirot.selectProject',
        title: 'Select Project',
        arguments: [relativePath],
      };
    }
  }
}

/**
 * Tree data provider for project selection
 */
export class ProjectSelectorProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private projectService: ProjectService;
  private _onDidChangeTreeData: vscode.EventEmitter<void>;
  public onDidChangeTreeData: vscode.Event<void>;
  private availableProjects: Project[];
  private activeProjectPath: string | null;
  private refreshInProgress: boolean;
  private pendingRefresh: boolean | null;

  constructor() {
    this.projectService = new ProjectService();
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.availableProjects = [];
    this.activeProjectPath = null;
    this.refreshInProgress = false;
    this.pendingRefresh = null;
  }

  /**
   * Refresh the project list
   */
  async refresh(): Promise<void> {
    // Prevent concurrent refresh calls
    if (this.refreshInProgress) {
      this.pendingRefresh = true;
      return;
    }

    this.refreshInProgress = true;

    try {
      // Update available projects and active project
      if (vscode.workspace.workspaceFolders?.[0]) {
        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        this.availableProjects = await this.projectService.scanForProjects(workspacePath);
        this.activeProjectPath = this.projectService.getActiveProjectPath(workspacePath);
      }

      this._onDidChangeTreeData.fire();
    } finally {
      this.refreshInProgress = false;

      // Process pending refresh if any
      if (this.pendingRefresh) {
        this.pendingRefresh = null;
        await this.refresh();
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
   * Get children for a tree element
   * @param element The parent element
   * @returns The children
   */
  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Root level - return project selection node if multiple projects
      if (this.availableProjects.length > 1) {
        const activeProjectName = this.activeProjectPath
          ? this.projectService.getProjectName(this.activeProjectPath)
          : 'Workspace Root';

        return [new ProjectSelectionNode(activeProjectName, this.availableProjects.length)];
      }

      // No projects or single project - show nothing
      return [];
    }

    if (element instanceof ProjectSelectionNode) {
      // Return available projects for selection
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspacePath) return [];

      return this.availableProjects.map(
        (project) =>
          new ProjectOptionNode(
            project.name,
            project.relativePath,
            project.path === this.activeProjectPath
          )
      );
    }

    return [];
  }
}

export { ProjectSelectionNode, ProjectOptionNode };
