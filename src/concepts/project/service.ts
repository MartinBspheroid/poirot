import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type Project = {
  path: string;
  name: string;
  relativePath: string;
};

type QuickPickItem = {
  label: string;
  description: string;
  detail: string;
  path: string;
};

/**
 * Service for managing project selection in monorepo environments
 * Scans for project.inlang files and allows users to select active project
 */
export class ProjectService {
  private _onDidChangeActiveProject: vscode.EventEmitter<string>;
  public onDidChangeActiveProject: vscode.Event<string>;

  constructor() {
    this._onDidChangeActiveProject = new vscode.EventEmitter();
    this.onDidChangeActiveProject = this._onDidChangeActiveProject.event;
  }

  /**
   * Scan workspace for project.inlang files
   * @param workspacePath The workspace root path
   * @returns Array of found projects
   */
  async scanForProjects(workspacePath: string): Promise<Project[]> {
    const projects: Project[] = [];

    try {
      // Use glob pattern to find all project.inlang directories
      const pattern = '**/project.inlang/settings.json';
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

      for (const file of files) {
        const projectPath = path.dirname(path.dirname(file.fsPath));
        const relativePath = path.relative(workspacePath, projectPath);
        const projectName = this.getProjectName(projectPath);

        projects.push({
          path: projectPath,
          name: projectName,
          relativePath: relativePath,
        });
      }

      console.log(`🔍 Found ${projects.length} project.inlang projects`);
    } catch (error) {
      console.error('Error scanning for projects:', error);
    }

    return projects;
  }

  /**
   * Get a display name for the project
   * @param projectPath The project path
   * @returns The project display name
   */
  getProjectName(projectPath: string): string {
    const packageJsonPath = path.join(projectPath, 'package.json');

    try {
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
          name?: string;
        };
        if (packageJson.name) {
          return packageJson.name;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Could not read package.json at ${projectPath}:`, errorMessage);
    }

    // Fallback to directory name
    return path.basename(projectPath);
  }

  /**
   * Get the currently active project path
   * @param workspacePath The workspace root path
   * @returns The active project path
   */
  getActiveProjectPath(workspacePath: string): string {
    const config = vscode.workspace.getConfiguration('poirot');
    const savedProject = config.get<string | null>('activeProject');

    if (savedProject) {
      // Check if saved project still exists
      const savedPath = path.join(workspacePath, savedProject);
      if (fs.existsSync(path.join(savedPath, 'project.inlang', 'settings.json'))) {
        return savedPath;
      }
    }

    // Default to workspace root if no saved project or it doesn't exist
    return workspacePath;
  }

  /**
   * Set the active project
   * @param workspacePath The workspace root path
   * @param projectPath The project path to set as active
   */
  async setActiveProject(workspacePath: string, projectPath: string): Promise<void> {
    try {
      const relativePath = path.relative(workspacePath, projectPath);
      const config = vscode.workspace.getConfiguration('poirot');

      await config.update('activeProject', relativePath, vscode.ConfigurationTarget.Workspace);

      console.log(`📁 Active project set to: ${relativePath}`);
      this._onDidChangeActiveProject.fire(projectPath);
    } catch (error) {
      console.error('Error setting active project:', error);
      throw error;
    }
  }

  /**
   * Show project selection quick pick to user
   * @param workspacePath The workspace root path
   * @returns The selected project path or null if cancelled
   */
  async showProjectSelection(workspacePath: string): Promise<string | null> {
    const projects = await this.scanForProjects(workspacePath);

    if (projects.length === 0) {
      vscode.window.showInformationMessage('No project.inlang projects found in workspace');
      return null;
    }

    if (projects.length === 1) {
      // Auto-select if only one project found
      const project = projects[0];
      await this.setActiveProject(workspacePath, project.path);
      return project.path;
    }

    // Show selection dialog for multiple projects
    const items: QuickPickItem[] = projects.map((project) => ({
      label: project.name,
      description: project.relativePath,
      detail: `Project path: ${project.relativePath}`,
      path: project.path,
    }));

    // Add workspace root as an option
    items.unshift({
      label: '$(root-folder) Workspace Root',
      description: '/',
      detail: 'Use workspace root as project',
      path: workspacePath,
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select the active project for translation management',
      ignoreFocusOut: true,
    });

    if (selected) {
      await this.setActiveProject(workspacePath, selected.path);
      return selected.path;
    }

    return null;
  }

  /**
   * Check if a path contains a valid project.inlang configuration
   * @param projectPath The path to check
   * @returns True if valid project.inlang exists
   */
  isValidProjectPath(projectPath: string): boolean {
    try {
      const settingsPath = path.join(projectPath, 'project.inlang', 'settings.json');
      return fs.existsSync(settingsPath);
    } catch {
      return false;
    }
  }

  /**
   * Get the project path for a given file
   * @param filePath The file path
   * @param projects The list of available projects
   * @returns The project path or null if not found
   */
  getProjectForFile(filePath: string, projects: Project[]): string | null {
    // Sort projects by path length (descending) to match the most specific project first
    const sortedProjects = [...projects].sort((a, b) => b.path.length - a.path.length);

    for (const project of sortedProjects) {
      if (filePath.startsWith(project.path + path.sep) || filePath === project.path) {
        return project.path;
      }
    }

    return null;
  }
}
