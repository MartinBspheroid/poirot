import * as fs from 'fs';
import * as path from 'path';

/**
 * Repository for loading translation data from files
 */
export class TranslationRepository {
  /**
   * Load translations for the specified locale
   * @param translationFilePath The full path to the translation file
   * @param locale The locale for logging purposes
   * @returns The translations object or null if not found
   */
  async loadTranslations(
    translationFilePath: string,
    locale: string
  ): Promise<Record<string, unknown> | null> {
    try {
      console.log(
        `📖 Reading translations from: ${path.basename(translationFilePath)} (locale: ${locale})`
      );

      if (!fs.existsSync(translationFilePath)) {
        console.log(`❌ Translation file not found: ${translationFilePath}`);
        return null;
      }

      const fileContent = fs.readFileSync(translationFilePath, 'utf8');
      const translations: Record<string, unknown> = JSON.parse(fileContent);

      console.log(
        `✅ Loaded ${Object.keys(translations).length} translations for locale '${locale}'`
      );

      return translations;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`❌ Failed to load translations: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Check if a translation file exists
   * @param translationFilePath The full path to the translation file
   * @returns True if the file exists
   */
  translationFileExists(translationFilePath: string): boolean {
    return fs.existsSync(translationFilePath);
  }
}
