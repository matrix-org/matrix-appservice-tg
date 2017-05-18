var Cli = require("matrix-appservice-bridge").Cli;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;

var Main = require("./lib/Main");

// TODO(paul) Workaround for prom-client 9 no longer doing this by default
//   see also https://github.com/matrix-org/matrix-appservice-bridge/pull/58
require("prom-client").collectDefaultMetrics();

new Cli({
    registrationPath: "telegram-registration.yaml",
    bridgeConfig: {
        schema: "config/telegram-config-schema.yaml",
    },
    generateRegistration: function(reg, callback) {
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("telegrambot");
        reg.addRegexPattern("users", "@telegram_.*", true);
        // reg.addRegexPattern("aliases", "#telegram_.*", true);
        reg.setId("telegram");
        callback(reg);
    },
    run: function(port, config) {
        console.log("Matrix-side listening on port %s", port);
        (new Main(config)).run(port);
    },
}).run();
