import { defineConfig } from 'vite';

// base './'：打包产物用相对路径，部署到 GitHub Pages 子路径也能直接跑
export default defineConfig({
  base: './',
});
