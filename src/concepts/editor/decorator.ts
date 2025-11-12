import * as vscode from 'vscode';

type TranslationResult = {
  end: number;
  warningType?: 'missingLocale' | 'noLocale' | null;
  translationValue: string | null;
};

type RenderOptions = {
  after?: {
    contentText: string;
    color: string;
    fontStyle: string;
    border: string;
    borderRadius: string;
    padding: string;
    margin: string;
  };
};

type Decoration = {
  range: vscode.Range;
  renderOptions: RenderOptions;
};

/**
 * Decorator for managing VS Code text decorations for translation displays
 */
export class EditorDecorator {
  private activeDecorations: Map<string, Decoration[]>;
  private translationDecorationType: vscode.TextEditorDecorationType | null;

  constructor() {
    this.activeDecorations = new Map();
    this.translationDecorationType = null;
  }

  /**
   * Initialize the decoration type
   * @returns The decoration type
   */
  initializeDecorationType(): vscode.TextEditorDecorationType {
    if (!this.translationDecorationType) {
      this.translationDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
          margin: '0 0 0 1em',
          color: '#888888',
          fontStyle: 'italic',
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });
    }
    return this.translationDecorationType;
  }

  /**
   * Create decorations for translation results
   * @param document The VS Code document
   * @param translationResults Array of translation results with call info and values
   * @returns Array of decoration objects
   */
  createDecorations(
    document: vscode.TextDocument,
    translationResults: TranslationResult[]
  ): Decoration[] {
    const decorations: Decoration[] = [];

    for (const result of translationResults) {
      let contentText: string;
      let color: string;
      let borderColor: string;

      if (result.warningType === 'noLocale') {
        // Red alert for missing translation
        contentText = '<missing>';
        color = '#cc6666';
        borderColor = '#cc6666';
      } else if (result.warningType === 'missingLocale') {
        // Yellow warning + translation from other locale
        contentText = `"${result.translationValue}" (locales missing)`;
        color = '#d4a574';
        borderColor = '#d4a574';
      } else {
        // Normal case - translation found in current locale
        contentText = `"${result.translationValue}"`;
        color = '#888888';
        borderColor = '#888888';
      }

      const decoration: Decoration = {
        range: new vscode.Range(document.positionAt(result.end), document.positionAt(result.end)),
        renderOptions: {
          after: {
            contentText: contentText,
            color: color,
            fontStyle: 'italic',
            border: `1px solid ${borderColor}`,
            borderRadius: '4px',
            padding: '2px 4px',
            margin: '0 2px',
          },
        },
      };
      decorations.push(decoration);
    }

    return decorations;
  }

  /**
   * Apply decorations to an editor
   * @param editor The VS Code text editor
   * @param decorations Array of decoration objects
   */
  applyDecorations(editor: vscode.TextEditor, decorations: Decoration[]): void {
    const decorationType = this.initializeDecorationType();
    editor.setDecorations(decorationType, decorations as vscode.DecorationOptions[]);
    this.activeDecorations.set(editor.document.uri.toString(), decorations);
  }

  /**
   * Clear decorations for a document
   * @param editor The VS Code text editor
   */
  clearDecorations(editor: vscode.TextEditor): void {
    if (
      this.translationDecorationType &&
      this.activeDecorations.has(editor.document.uri.toString())
    ) {
      editor.setDecorations(this.translationDecorationType, []);
      this.activeDecorations.delete(editor.document.uri.toString());
    }
  }

  /**
   * Clear all active decorations
   */
  clearAllDecorations(): void {
    this.activeDecorations.clear();
  }

  /**
   * Get the decoration type for disposal
   * @returns The decoration type
   */
  getDecorationType(): vscode.TextEditorDecorationType | null {
    return this.translationDecorationType;
  }

  /**
   * Dispose of the decorator resources
   */
  dispose(): void {
    this.clearAllDecorations();
    if (this.translationDecorationType) {
      this.translationDecorationType.dispose();
      this.translationDecorationType = null;
    }
  }
}
