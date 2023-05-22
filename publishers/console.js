// Publisher which only displays output on standardout

module.exports.api = {
    checkArgumentsOrExit: (args) => { },
    initialize: (args) => { },
    publish: (args, deviceid, obj) => {
        console.log(deviceid, obj);
    },
    getVersionString: () => {
        return "Console Publisher";
    }
}

