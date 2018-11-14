# Fixer.io MongoDB proxy

A simple web app that stores fixer.io results in mongodb to prevent rate limiting

## Setup

Set up can be done two ways, either through enviroment variables or through the a config file.
If you choose the enviroment variable approach you'll need to set `MONGODB_URI`and `FIXER_ACCESS_KEY` to it's respective values. If you want to go the config file route you must create a file in the `config` directory with the name either `production.json` or `development.json` for the two usecases of enviroment.

Here's a default template for your config.
```
{
    "mongodbUri": "",
    "fixerAccessKey": ""
}
```
