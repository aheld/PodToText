// rollup.config.js
import typescript from 'rollup-plugin-typescript2';
import commonjs from 'rollup-plugin-commonjs';

export default {
    input: './src/index.ts',
    output: {
        file: './dist/index.js',
        format: 'cjs'
    },
  external: [ 'aws-sdk','fs', 'path', 'child_process'  ],
  plugins: [ typescript(),
        commonjs({
            namedExports: {
                // left-hand side can be an absolute path, a path
                // relative to the current directory, or the name
                // of a module in node_modules
                'node_modules/async/dist/async.js': [ 'waterfall', 'parallel' ]
            }
        })

    ]
};