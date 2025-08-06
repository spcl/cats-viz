// This file uses CommonJS require instead of ES6 imports because it is not
// transpiled
const path = require('path');
const webpack = require('webpack');

const coreConfig = {
    module: {
        rules: [
            {
                test: /\.m?[jt]sx?$/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            configFile: 'tsconfig-build.json',
                        },
                    },
                ],
                exclude: /node_modules/,
            },
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    'css-loader',
                ],
            },
            {
                test: /\.(s[ac]ss)$/,
                use: [
                    'style-loader',
                    'css-loader',
                    'sass-loader',
                ],
            },
            {
                test: /\.(woff|woff2|otf|eot|ttf)$/i,
                type: 'asset/resource',
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js', '.tsx', '.jsx'],
        alias: {
            assert: require.resolve('assert'),
            buffer: require.resolve('buffer'),
            stream: require.resolve('stream-browserify'),
            zlib: require.resolve('browserify-zlib'),
        }
    },
    devtool: 'source-map',
    devServer: {
        port: 3001,
        static: {
            directory: __dirname,
        },
        devMiddleware: {
            writeToDisk: true,
        },
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser',
        }),
    ]
}

const mainConfig = {
    name: 'main',
    entry: {
        access_stats: './src/access_statistics_view.ts',
        access_timeline: './src/access_timeline_view.ts',
        control_flow_view: './src/control_flow_view.ts',
    },
    ...coreConfig,
};

module.exports = [
    mainConfig,
];
