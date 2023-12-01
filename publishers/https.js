// Publisher which publishes on https
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const printErrorAndExit = (info) => {
    console.log(info);
    process.exit(1);
}

module.exports.api = {
    checkArgumentsOrExit: (args) => { 
        if (!args.S)
            printErrorAndExit("HTPPS Publisher: -S <url> is required");
    },
    initialize: (args) => {
    },
    publish: async (args, deviceid, obj) => {
        console.log("HTTPS Publish to " + args.s, deviceid, obj);
        const url = args.S;
        try {
            await fetch(url, { 
                method:"POST", 
                body: JSON.stringify(obj), 
                headers: {
                    "Accept": "application/json",
                    "Content-type" : "application/json",
                    "cache-control": "no-cache"
              },}).then(response => response.json())
              .then(data => {console.log("  Response: ", data); return data; })
              .catch(err => {console.log("  HTTPS Publish Failed: " + err.message); throw(err);});
        } catch (e) {
            console.log("  HTTPS Publisher: Failed to publish: ", e.message);
        }
    },
    getVersionString: () => {
        return "HTTPS Publisher";
    }
}

