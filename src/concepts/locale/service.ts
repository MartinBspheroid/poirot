import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectService } from '../project/service';

type InlangSettings = {
  baseLocale?: string;
  locales?: string[];
  'plugin.inlang.messageFormat'?: {
    pathPattern?: string;
  };
};

/**
 * Service for managing locale configuration and inlang project settings
 */
export class LocaleService {
  private projectService: ProjectService;

  constructor() {
    this.projectService = new ProjectService();
  }

  /**
   * Get the current locale from various sources in priority order
   * @returns The current locale code
   */
  getCurrentLocale(): string {
    // 1. Check VS Code configuration
    const config = vscode.workspace.getConfiguration('poirot');
    const configLocale = config.get<string>('defaultLocale');
    if (configLocale) {
      return configLocale;
    }

    // 2. Check inlang settings if we have a workspace
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      const inlangSettings = this.loadInlangSettings(
        vscode.workspace.workspaceFolders[0].uri.fsPath
      );
      if (inlangSettings?.baseLocale) {
        return inlangSettings.baseLocale;
      }
    }

    // 3. Default to English
    return 'en';
  }

  /**
   * Load inlang project settings
   * @param workspacePath The workspace root path
   * @returns The inlang settings or null if not found
   */
  loadInlangSettings(workspacePath: string): InlangSettings | null {
    try {
      // Get the active project path
      const projectPath = this.projectService.getActiveProjectPath(workspacePath);
      const inlangSettingsPath = path.join(projectPath, 'project.inlang', 'settings.json');

      if (!fs.existsSync(inlangSettingsPath)) {
        console.log(`📝 No inlang settings found at: ${inlangSettingsPath}`);
        return null;
      }

      const fileContent = fs.readFileSync(inlangSettingsPath, 'utf8');
      const settings: InlangSettings = JSON.parse(fileContent);

      console.log(`📖 Loaded inlang settings from: ${path.basename(inlangSettingsPath)}`);

      return settings;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`❌ Failed to load inlang settings: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Get the path pattern for translation files
   * @param workspacePath The workspace root path
   * @returns The path pattern for translation files
   */
  getTranslationPathPattern(workspacePath: string): string {
    const inlangSettings = this.loadInlangSettings(workspacePath);

    if (
      inlangSettings &&
      inlangSettings['plugin.inlang.messageFormat'] &&
      inlangSettings['plugin.inlang.messageFormat'].pathPattern
    ) {
      return inlangSettings['plugin.inlang.messageFormat'].pathPattern;
    }

    // Fallback to default pattern
    return './messages/{locale}.json';
  }

  /**
   * Resolve the actual translation file path
   * @param workspacePath The workspace root path
   * @param locale The locale
   * @returns The resolved path to the translation file
   */
  resolveTranslationPath(workspacePath: string, locale: string): string {
    // Get the active project path
    const projectPath = this.projectService.getActiveProjectPath(workspacePath);
    const pathPattern = this.getTranslationPathPattern(workspacePath);

    // Replace {locale} placeholder with actual locale
    const relativePath = pathPattern.replace('{locale}', locale);

    // Resolve relative path from project root
    let resolvedPath: string;
    if (relativePath.startsWith('./')) {
      resolvedPath = path.join(projectPath, relativePath.substring(2));
    } else if (relativePath.startsWith('/')) {
      resolvedPath = path.join(projectPath, relativePath.substring(1));
    } else {
      resolvedPath = path.join(projectPath, relativePath);
    }

    console.log(`🔍 Resolved translation path for locale '${locale}': ${resolvedPath}`);

    return resolvedPath;
  }

  /**
   * Update the current locale in VS Code configuration
   * @param locale The new locale to set
   */
  async updateLocale(locale: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('poirot');
    await config.update('defaultLocale', locale, vscode.ConfigurationTarget.Workspace);
  }
}
