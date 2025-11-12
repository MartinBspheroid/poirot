import * as vscode from 'vscode';
import { ExtensionActivator } from './concepts/extension/activator';

// Create a single instance of the extension activator
const extensionActivator = new ExtensionActivator();

/**
 * This method is called when your extension is activated
 * Your extension is activated the very first time the command is executed
 */
export function activate(context: vscode.ExtensionContext): void {
  extensionActivator.activate(context);
}

/**
 * This method is called when your extension is deactivated
 */
export function deactivate(): void {
  extensionActivator.deactivate();
}
