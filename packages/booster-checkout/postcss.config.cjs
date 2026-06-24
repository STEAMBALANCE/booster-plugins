// booster-plugins/packages/booster-checkout/postcss.config.cjs
// Контекст: ctx.env приходит от svelte-preprocess (production / development).
module.exports = (ctx) => ({
  plugins: [
    require('autoprefixer'),
    require('postcss-preset-env')({ stage: 2 }),
    ...(ctx.env === 'production' ? [require('cssnano')({ preset: 'default' })] : []),
  ],
});
