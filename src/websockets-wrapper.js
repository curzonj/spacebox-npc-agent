'use strict';

var C = require('spacebox-common')
var WebSocket = require('ws')
var uuidGen = require('node-uuid')
var Q = require('q')
var util = require('util')
var urlUtil = require("url")
var events = require('events')

var WebsocketWrapper = function (urlq, logger) {
    this.logger = logger
    this.urlq = urlq
    this.reconnectTimer = null
}
util.inherits(WebsocketWrapper, events.EventEmitter)

C.deepMerge({
    getReadyState: function() {
        if (this.connection !== undefined) {
            return this.connection.readyState
        }
    },
    onOpen: function(fn) {
        this.on('open', fn)

        if (this.getReadyState() == WebSocket.OPEN) {
            fn(this.connection)
        }
    },
    cmd: function(name, opts) {
        if (opts === undefined) {
            opts = {}
        }

        opts.command = name
        opts.request_id = uuidGen.v1()
        this.logger.debug(opts, 'sending')

        this.connection.send(JSON.stringify(opts))

        return opts.request_id
    },
    close: function() {
        this.connection.close();
    },
    connect: function() {
        var self = this

        Q(self.urlq).then(function(url) {
            var conn = new WebSocket(url)

            conn.onopen = self._onopen.bind(self)
            conn.onclose = self._onclose.bind(self)
            conn.onerror = self._onerror.bind(self)
            conn.onmessage = self._onmessage.bind(self)

            self.connection = conn
        }).done()
    },
    scheduleKeepAlive: function() {
        var self = this

        if (self.keepAliveInterval)
            return 

        self.keepAliveInterval = setInterval(function() {
            self.cmd("ping")
        }, 20000)
    },
    cancelKeepAlive: function() {
        clearInterval(this.keepAliveInterval)
        delete this.keepAliveInterval
    },
    _onopen: function() {
        this.scheduleKeepAlive()

        this.emit('open', this.connection)
    },

    _onclose: function(e) {
        this.cancelKeepAlive()

        this.emit('close', e, this.connection)
        this._reconnect();
    },
    _reconnect: function() {
        var self = this

        if (self.reconnectTimer !== null)
            return 

        self.logger.debug("waiting 5sec to reconnect")
        self.reconnectTimer = setTimeout(function() {
            self.reconnectTimer = null

            self.logger.debug("reconnecting")
            self.connect()
        }, 5000)
    },
    _onerror: function(error) {
        this.logger.debug({ err: error }, 'WebSocket Error')
        this.cancelKeepAlive()

        // Don't emit undhandled error events
        if (this.listeners('error').length > 0) {
            this.emit('error', error, this.connection)
        }

        this._reconnect()
    },
    _onmessage: function(message) {
        this.emit('message', message, this.connection)
    }
}, WebsocketWrapper.prototype)


module.exports = function(client) {
    var logger = client.logger

    function websocketUrl(service) {
        return Q.spread([client.getEndpoints(), client.getAuthToken()], function(endpoints, token) {
            if (endpoints[service] === undefined) {
                throw new Error(Object.keys(endpoints)+ " is missing "+service)
            }

            var new_uri,
                path = '/',
                loc = urlUtil.parse(endpoints[service])

            if (loc.protocol === "https:") {
                new_uri = "wss:"
            } else {
                new_uri = "ws:"
            }
            new_uri += "//" + loc.host + path + '?token=' + token

            logger.debug({ url: new_uri }, "authenticated, connecting")
            return new_uri
        })
    }

    return function() {
        var urlq = websocketUrl('3dsim')
        var h = new WebsocketWrapper(urlq, logger)

        // This is an async call
        h.connect()

        return h
    }
}
