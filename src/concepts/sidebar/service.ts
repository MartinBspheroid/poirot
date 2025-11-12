import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TranslationService } from '../translation/service';
import { LocaleService } from '../locale/service';
import { ProjectService } from '../project/service';

type LocaleData = {
  locale: string;
  value: string;
  workspacePath: string;
};

type TranslationKeyData = {
  key: string;
  locales: LocaleData[];
};

/**
 * Service for managing sidebar translation data
 */
export class SidebarService {
  private translationService: TranslationService;
  private localeService: LocaleService;
  private projectService: ProjectService;

  constructor() {
    this.translationService = new TranslationService();
    this.localeService = new LocaleService();
    this.projectService = new ProjectService();
  }

  /**
   * Get all translation data for the current document
   * @param document The current document
   * @returns Array of translation key objects with locale data
   */
  async getTranslationData(document: vscode.TextDocument | null): Promise<TranslationKeyData[]> {
    try {
      if (!document) return [];

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) return [];

      const workspacePath = workspaceFolder.uri.fsPath;
      const projectPath = this.projectService.getActiveProjectPath(workspacePath);
      const text = document.getText();

      // Find all m.methodName() calls in the current file
      const translationCalls = this.translationService.findTranslationCalls(text);
      if (translationCalls.length === 0) return [];

      // Get available locales from inlang settings or fallback
      const availableLocales = await this.getAvailableLocales(workspacePath);

      // Create translation data structure
      const translationData: TranslationKeyData[] = [];

      for (const call of translationCalls) {
        const keyData: TranslationKeyData = {
          key: call.methodName,
          locales: [],
        };

        for (const locale of availableLocales) {
          const translations = await this.translationService.loadTranslationsForLocale(
            workspacePath,
            locale
          );
          const translationValue = translations
            ? this.translationService.getTranslation(translations, call.methodName)
            : null;

          // Only add locale data if the translation exists (not null/undefined)
          if (translationValue !== null) {
            keyData.locales.push({
              locale,
              value: translationValue,
              workspacePath: projectPath,
            });
          }
        }

        // Only add keys that have at least one translation
        if (keyData.locales.length > 0) {
          translationData.push(keyData);
        }
      }

      return translationData;
    } catch (error) {
      console.error('Error getting translation data for sidebar:', error);
      return [];
    }
  }

  /**
   * Get available locales from inlang settings or fallback
   * @param workspacePath The workspace root path
   * @returns Array of available locale codes
   */
  async getAvailableLocales(workspacePath: string): Promise<string[]> {
    try {
      const projectPath = this.projectService.getActiveProjectPath(workspacePath);
      const inlangSettings = this.localeService.loadInlangSettings(workspacePath);

      if (inlangSettings?.locales) {
        return inlangSettings.locales;
      }

      // Fallback: try to detect existing locale files in project directory
      const messagesDir = path.join(projectPath, 'messages');
      if (fs.existsSync(messagesDir)) {
        const files = fs.readdirSync(messagesDir);
        const locales = files
          .filter((file) => file.endsWith('.json'))
          .map((file) => path.basename(file, '.json'));

        if (locales.length > 0) {
          return locales;
        }
      }

      // Ultimate fallback
      return ['en'];
    } catch (error) {
      console.error('Error getting available locales:', error);
      return ['en'];
    }
  }

  /**
   * Open a translation file and navigate to a specific key
   * @param workspacePath The workspace root path
   * @param locale The locale to open
   * @param key The translation key to navigate to
   */
  async openTranslationFile(workspacePath: string, locale: string, key: string): Promise<void> {
    try {
      const translationPath = this.localeService.resolveTranslationPath(workspacePath, locale);

      // Check if file exists
      if (!fs.existsSync(translationPath)) {
        vscode.window.showErrorMessage(`Translation file not found: ${translationPath}`);
        return;
      }

      // Open the file
      const document = await vscode.workspace.openTextDocument(translationPath);
      const editor = await vscode.window.showTextDocument(document);

      // Find the key in the file and navigate to it
      await this.navigateToKey(editor, key);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Error opening translation file:', error);
      vscode.window.showErrorMessage(`Failed to open translation file: ${errorMessage}`);
    }
  }

  /**
   * Navigate to a specific key in the translation file and highlight its value (supports nested keys)
   * @param editor The text editor
   * @param key The key to find (can be nested like "login.inputs.email")
   */
  async navigateToKey(editor: vscode.TextEditor, key: string): Promise<void> {
    try {
      const document = editor.document;

      // Get workspace folder to determine locale from file path
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('Cannot determine workspace folder');
        return;
      }

      const workspacePath = workspaceFolder.uri.fsPath;
      const filePath = document.uri.fsPath;

      // Determine locale from file path
      const fileName = path.basename(filePath, '.json');
      const locale = fileName; // Assuming file name is the locale

      // Use existing TranslationService to load and process the translation
      const translations = await this.translationService.loadTranslationsForLocale(
        workspacePath,
        locale
      );
      if (!translations) {
        vscode.window.showWarningMessage(`Could not load translations for locale: ${locale}`);
        return;
      }

      // Use existing getTranslation method to get the processed value (handles both simple and complex)
      const translationValue = this.translationService.getTranslation(translations, key);
      if (translationValue == null) {
        vscode.window.showWarningMessage(`Key "${key}" not found in translation file`);
        return;
      }

      // Remove the asterisk if present (added by complex structure processing)
      const searchValue = translationValue.endsWith('*')
        ? translationValue.slice(0, -1)
        : translationValue;

      // Try to navigate to the value first
      if (await this.navigateToValue(editor, searchValue)) {
        console.log(
          `🎯 Navigated to key "${key}" (value: "${searchValue}") in ${document.fileName}`
        );
        return;
      }

      // Fallback: navigate to the key itself
      if (await this.navigateToKeyName(editor, key)) {
        console.log(`🎯 Navigated to key "${key}" (key location) in ${document.fileName}`);
        return;
      }

      vscode.window.showWarningMessage(`Key "${key}" not found in translation file`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Error navigating to key:', error);
      vscode.window.showErrorMessage(`Failed to navigate to key: ${errorMessage}`);
    }
  }

  /**
   * Navigate to a translation value in the file
   * @param editor The text editor
   * @param value The value to find
   * @returns True if navigation was successful
   */
  async navigateToValue(editor: vscode.TextEditor, value: string): Promise<boolean> {
    try {
      const document = editor.document;
      const text = document.getText();

      const valueRegex = new RegExp(`"${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
      const match = valueRegex.exec(text);

      if (match) {
        // Highlight the value (without quotes)
        const valueStart = match.index + 1; // Skip opening quote
        const valueEnd = valueStart + value.length;

        const startPos = document.positionAt(valueStart);
        const endPos = document.positionAt(valueEnd);

        const selection = new vscode.Selection(startPos, endPos);
        editor.selection = selection;
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);

        return true;
      }

      return false;
    } catch (error) {
      console.error('Error navigating to value:', error);
      return false;
    }
  }

  /**
   * Navigate to a translation key in the file (supports nested keys)
   * @param editor The text editor
   * @param key The key to find (can be nested like "login.inputs.email")
   * @returns True if navigation was successful
   */
  async navigateToKeyName(editor: vscode.TextEditor, key: string): Promise<boolean> {
    try {
      const document = editor.document;
      const text = document.getText();

      if (key.includes('.')) {
        // Nested key - search for the final key name
        const keyParts = key.split('.');
        const finalKey = keyParts[keyParts.length - 1];

        // Create a regex pattern that matches the nested structure
        // This is more complex, so we'll use a simpler approach: search for the final key
        const keyRegex = new RegExp(
          `"${finalKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`,
          'g'
        );

        let match: RegExpExecArray | null;
        const matches: RegExpExecArray[] = [];

        // Find all matches and look for the one in the right context
        while ((match = keyRegex.exec(text)) !== null) {
          matches.push(match);
        }

        // For nested keys, try to find the correct match by checking context
        for (const m of matches) {
          // Simple heuristic: check if we're in the right nested context
          const beforeText = text.substring(Math.max(0, m.index - 200), m.index);
          const containsParentKeys = keyParts
            .slice(0, -1)
            .every((parentKey) => beforeText.includes(`"${parentKey}"`));

          if (containsParentKeys || matches.length === 1) {
            const keyStart = m.index + 1; // Skip opening quote
            const keyEnd = keyStart + finalKey.length;

            const startPos = document.positionAt(keyStart);
            const endPos = document.positionAt(keyEnd);

            const selection = new vscode.Selection(startPos, endPos);
            editor.selection = selection;
            editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);

            return true;
          }
        }

        // If no good context match, use first match
        if (matches.length > 0) {
          const m = matches[0];
          const keyStart = m.index + 1; // Skip opening quote
          const keyEnd = keyStart + finalKey.length;

          const startPos = document.positionAt(keyStart);
          const endPos = document.positionAt(keyEnd);

          const selection = new vscode.Selection(startPos, endPos);
          editor.selection = selection;
          editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);

          return true;
        }
      } else {
        // Flat key - simple search
        const keyRegex = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
        const keyMatch = keyRegex.exec(text);

        if (keyMatch) {
          const startPos = document.positionAt(keyMatch.index);
          const endPos = document.positionAt(keyMatch.index + keyMatch[0].length);

          const selection = new vscode.Selection(startPos, endPos);
          editor.selection = selection;
          editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);

          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Error navigating to key name:', error);
      return false;
    }
  }

  /**
   * Check if a document is a translation file
   * @param document The document to check
   * @returns True if this is a translation file
   */
  async isTranslationFile(document: vscode.TextDocument): Promise<boolean> {
    try {
      if (!document) {
        return false;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        return false;
      }

      const workspacePath = workspaceFolder.uri.fsPath;
      const projectPath = this.projectService.getActiveProjectPath(workspacePath);
      const filePath = document.uri.fsPath;

      // Get the path pattern for translation files
      const pathPattern = this.localeService.getTranslationPathPattern(workspacePath);

      const relativePath = path.relative(projectPath, filePath);

      // Normalize paths for comparison (handle Windows paths)
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');

      // Use the actual available locales from configuration instead of hardcoding
      const availableLocales = await this.getAvailableLocales(workspacePath);

      for (const locale of availableLocales) {
        let expectedPath = pathPattern.replace('{locale}', locale);

        // Handle different path formats
        if (expectedPath.startsWith('./')) {
          expectedPath = expectedPath.substring(2);
        }

        // Normalize expected path
        expectedPath = expectedPath.replace(/\\/g, '/');

        if (normalizedRelativePath === expectedPath) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking if file is translation file:', error);
      return false;
    }
  }
}
