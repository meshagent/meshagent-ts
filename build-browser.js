const esbuild = require("esbuild");

const define = {
    "process.env.MESHAGENT_SECRET": JSON.stringify(process.env.MESHAGENT_SECRET),
    "process.env.MESHAGENT_PROJECT_ID": JSON.stringify(process.env.MESHAGENT_PROJECT_ID),
    "process.env.MESHAGENT_KEY_ID": JSON.stringify(process.env.MESHAGENT_KEY_ID),
    "process.env.MESHAGENT_API_URL": JSON.stringify(process.env.MESHAGENT_API_URL),
};

esbuild.build({
    entryPoints: ["test/all-test.ts"],
    bundle: true,
    outfile: "browser-test/index.js",
    define,
}).catch((err) => console.error(err));
