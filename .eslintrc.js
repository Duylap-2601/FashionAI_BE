module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // tsconfig.json chỉ include src; bản này thêm test/ và prisma/ để lint phủ hết.
    project: 'tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  // Chỉ bật rule bắt lỗi logic/type. Formatting để `npm run format` (prettier) lo,
  // tránh thêm dependency chỉ để lint khoảng trắng.
  extends: ['plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules', 'coverage*'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    // Codebase dùng `any` ở ranh giới với payload provider bên ngoài (webhook,
    // response fal.ai/Gemini) nên cảnh báo thay vì chặn build.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
};
