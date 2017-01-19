Installation
------------

```sh
$ git clone ...
$ cd matrix-appservice-tg
$ npm install
```


Setup
-----

1. Create a new Matrix room to act as the administration control room. Note
   its internal room ID.

1. Create a `telegram-config.yaml` file for global configuration. There is a
   sample one to begin with in `config/telegram-config-sample.yaml` you may
   wish to copy and edit as appropriate. This needs the following keys:

   ```yaml
   matrix_homeserver: "http URL pointing at the homeserver"

   matrix_user_domain: "domain part of the homeserver's name. Used for
                        ghost username generation"

   username_template: "template for virtual users, e.g. telegram_${USER}"

   matrix_admin_room: "the ID of the room created in step 2"

   auth_key_password: "a random string used to obfuscate authentication keys
                       stored in the user database"
   ```

1. Pick/decide on a spare local TCP port number to run the application service
   on. This needs to be visible to the homeserver - take care to configure
   firewalls correctly if that is on another machine to the bridge. The port
   number will be noted as `$PORT` in the remaining instructions.

1. Generate the appservice registration file (if the application service runs
   on the same server you can use localhost as `$URL`):

   ```sh
   $ node index.js --generate-registration -f telegram-registration.yaml  -u $URL:$PORT
   ```

1. Start the actual application service. You can use forever

   ```sh
   $ forever start index.js --config telegram-config.yaml --port $PORT
   ```

   or node

   ```sh
   $ node index.js --config telegram-config.yaml --port $PORT
   ```

1. Copy the newly-generated `telegram-registration.yaml` file to the homeserver.
   Add the registration file to your homeserver config (default `homeserver.yaml`):

   ```yaml
   app_service_config_files:
      - ...
      - "/path/to/telegram-registration.yaml"
   ```

   Don't forget - it has to be a YAML list of strings, not just a single string.

   Restart your homeserver to have it reread the config file and establish a
   connection to the bridge.

1. Invite the newly-created `@telegrambot:DOMAIN` user into the admin control
   room created at step 1.

The bridge should now be running.

