import { defineConfig } from 'bumpp';

export default defineConfig({
  files: ['package.json', 'package-lock.json'],
  commit: true,
  tag: true,
  push: false,
  commitMessage: 'chore(release): v%s',
  execute: 'npm run build',
  confirm: true,
});
