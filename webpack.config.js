const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    devtool: isProd ? false : 'source-map',
    entry: './src/main.js',
    output: {
      filename: isProd ? 'app.[contenthash].js' : 'app.js',
      path: path.resolve(__dirname, 'dist'),
      clean: true,
      hashFunction: 'xxhash64',
      pathinfo: false,
    },
    optimization: {
      moduleIds: 'deterministic',
      chunkIds: 'deterministic',
      minimize: isProd,
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,

            { loader: 'css-loader', options: { url: false } },
          ],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './index.html',
        inject: 'body',
        minify: isProd ? { collapseWhitespace: true, removeComments: true } : false,
      }),
      new CopyPlugin({
        patterns: [{ from: 'public', to: '.' }],
      }),
      new MiniCssExtractPlugin({
        filename: isProd ? 'style.[contenthash].css' : 'style.css',
      }),
    ],
    devServer: {
      static: { directory: path.join(__dirname, 'public') },
      port: 3000,
      hot: true,
      open: true,
    },
    resolve: {
      fallback: {
        crypto: false,
        stream: false,
        buffer: false,
      },
    },
  };
};
