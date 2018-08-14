'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;

var NanoTimer = require('nanotimer');
var anesidora = require('anesidora');


module.exports = ControllerPandora;
function ControllerPandora(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;

}



ControllerPandora.prototype.onVolumioStart = function ()
{
	var self = this;
    var defer = libQ.defer();
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

    defer.resolve();
    
    return defer.promise;
};

ControllerPandora.prototype.onStart = function () {
    var self = this;

    self.servicename = 'pandora';
    self.stationList = [];
    self.currStation = {};
    self.songsArray = [];
    self.maxSongs = 4;

    self.state ={};

    self.loginInfo = {};
    self.loginInfo.email = self.config.get('email');
    self.loginInfo.password = self.config.get('password');
    self.loggedIn = false;

    self.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');

    if (!self.loginInfo.email || !self.loginInfo.password) { // not configured
        self.logger.error('[Pandora] Missing email or password');
        self.commandRouter.pushToastMessage('error',
                            'Pandora Login',
                            'Need email address and password. See plugin settings.');
        
        return libQ.reject('[Pandora] Need email and password');
    }

    return self.initialSetup()
        .then(function () {
            return self.addToBrowseSources();
        })
        .fail(function err() {
            self.logger.error('[Pandora] Error loading stations. ' + err);
            self.commandRouter.pushToastMessage('error',
                                    'Pandora login?',
                                    'Stations not loaded.  Check configuration');
            return libQ.reject(new Error(err));
        });
};

ControllerPandora.prototype.onStop = function () {
    var self = this;
    var defer=libQ.defer();
    
    return self.mpdPlugin.sendMpdCommand('stop', [])
        .then(function() {
            return self.mpdPlugin.sendMpdCommand('clear', []);
        });
    // Once the Plugin has successfull stopped resolve the promise
};

ControllerPandora.prototype.onRestart = function () {
    var self = this;
    // Optional, use if you need it
};


// Configuration Methods -----------------------------------------------------------------------------

ControllerPandora.prototype.getUIConfig = function () {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function (uiconf)
        {
            uiconf.sections[0].content[0].value = self.config.get('email', '');
            uiconf.sections[0].content[1].value = self.config.get('password', '');

            defer.resolve(uiconf);
        })
        .fail(function ()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

ControllerPandora.prototype.getConfigurationFiles = function () {
	return ['config.json'];
};

ControllerPandora.prototype.setUIConfig = function (data) {
	var self = this;
	//Perform your installation tasks here
};

ControllerPandora.prototype.getConf = function (varName) {
	var self = this;
	//Perform your installation tasks here
};

ControllerPandora.prototype.setConf = function (options) {
	var self = this;

    self.config.set('email', options.email);
    self.config.set('password', options.password);
    self.loginInfo.email = options.email;
    self.loginInfo.password = options.password;

    if (!self.loggedIn) {
        return self.initialSetup()
            .then(function () {
                return self.addToBrowseSources();
            })
            .fail(function err() {
                self.logger.error('[Pandora] Error loading stations. ' + err);
                self.commandRouter.pushToastMessage('error',
                                        'Pandora login?',
                                        'Stations not loaded.  Check configuration');
            });
    }
};



// Playback Controls ---------------------------------------------------------------------------------------
// If your plugin is not a music_sevice don't use this part and delete it


ControllerPandora.prototype.addToBrowseSources = function () {
	// Use this function to add your music service plugin to music sources
    var data = {
        name: 'Pandora Radio',
        uri: 'pandora',
        albumart: '/albumart?sourceicon=music_service/pandora/pandora.png',
        icon: 'fa fa-microphone',
        plugin_type: 'music_service',
        plugin_name: 'pandora'
    };

    this.commandRouter.volumioAddToBrowseSources(data);
};


ControllerPandora.prototype.initialSetup = function () {
    var self = this;
    var defer = libQ.defer();

    self.pandora = new anesidora(self.loginInfo.email, self.loginInfo.password);

    return self.pandoraLogin()
        .fail(function (err) {
            if (err === 1011) {
                self.logger.error('[Pandora] Invalid Username');
                self.commandRouter.pushToastMessage('error',
                                            'Pandora Login Error',
                                            'Invalid Username');
                defer.reject('Invalid Username');
            }
            else if (err === 1012) {
                self.logger.error('[Pandora] Invalid Password');
                self.commandRouter.pushToastMessage('error',
                                            'Pandora Login Error',
                                            'Invalid Password');
                defer.reject('Invalid Password');
            }
            else {
                self.logger.error('[Pandora] Other Login Error: ' + err);
                self.commandRouter.pushToastMessage('error',
                                            'Pandora Login Error',
                                            'Other Login Error: ' + err);
                defer.reject(new Error('[Pandora] Other login error: ' + err));
            }
        
        return defer.promise;
        })
        .then(function () {
            return self.pandoraUserGetStationList();
        })
        .fail(function (err) {
            defer.reject('[Pandora] Error getting stationList: ' + err);
            self.logger.error('[Pandora] Error getting stationList: ' + err);

            return defer.promise;
        })
        .then(function (stationList) {
            for (var i in stationList.stations) {
                self.stationList.push(stationList.stations[i].stationName);
            }
           defer.resolve(self.pandora.stationList);
           
           return defer.promise;
        })
        .fail(function (err) {
            defer.reject('[Pandora] Error retrieving stations from stationList: ' + err);
            self.logger.error('[Pandora] Error retrieving stations from stationList: ' + err);

            return defer.promise;
        });
};

ControllerPandora.prototype.handleBrowseUri = function (curUri) {
    var self = this;
    var defer = libQ.defer();

    var response = {
        navigation: {
            'prev': {
                uri: 'pandora'
            },
            'lists': [
                {
                    'availableListViews': ['list'],
                    'items': []
                }
            ]
        }
    };

    if (curUri.startsWith('pandora')) {
        if (curUri === 'pandora') {
            // iterate through self.StationList
            for (var i in self.stationList) {
                response.navigation.lists[0].items.push({
                    service:  self.servicename,
                    type: 'mywebradio',
                    artist: '',
                    title: self.stationList[i],
                    //name: self.stationList[i],
                    album: '',
                    icon: 'fa fa-music',
                    uri: 'pandora/stations/' + '?id=' + i
                });

            }
            defer.resolve(response);

            return defer.promise;
        }
    }
        // else if (curUri.startsWith('pandora/stations/?id=')) {
        //     // return station Uri or something
        //     var matches = curUri.match(/^.+\/\?id=(\d+)/);
        //     self.currStation = {id: matches[1], name: self.stationList[matches[1]]};
        //     self.commandRouter.pushToastMessage('info', 'Pandora Station Selected',
        //                                         'Loading ' + self.currStation.name);
           
        //     self.getTracks(self.maxSongs)
        //         .then(function (result) {
        //             response.navigation.lists[0].items = result;
        //             defer.resolve(response);
        //             return defer.promise;
        //             // self.songsArray = result;
        //             // return self.clearAddPlayTrack(result);
        //         });
            

        //     //response.navigation.lists[0].items.push({
        //     //    service: self.servicename,
        //     //    type: 'mywebradio',
        //     //    artist: '',
        //     //    title: self.stationList[matches[1]],
        //     //    album: '',
        //     //   icon: 'fa fa-music',
        //     //    uri: curUri
        //     //});

        //     //defer.resolve(response);
        //     //return defer.promise;
        // }
};

// Define a method to clear, add, and play an array of tracks
ControllerPandora.prototype.clearAddPlayTrack = function (tracks) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerPandora::clearAddPlayTrack');

    if (self.timer) {
        self.timer.clear();
    }
    self.commandRouter.logger.info(JSON.stringify(tracks));
    
    // var matches = curUri.match(/pandora\/stations\/\?id=(\d+)/);
    // self.currStation = {id: matches[1], name: self.stationList[matches[1]]};

    // return self.getTracks(self.maxSongs)
    //     .then(function (result) {
    //         self.songsArray = result;
    //         return libQ.resolve();
    //     })
    //     .then(function () {
    return self.mpdPlugin.sendMpdCommand('stop', [])
        .then(function () {
            return self.mpdPlugin.sendMpdCommand('clear', []);
        })
        .then(function () {
            // have mpd remove played tracks from playlist
            self.commandRouter.stateMachine.setConsumeUpdateService('mpd');
            return self.mpdPlugin.sendMpdCommand('consume 1', []);
        })
        .then(function () {
            // Here we go! (¡Juana's Adicción!)
            return self.playNextTrack(self.songsArray);
        })
        .fail(function (err) {
            return libQ.reject(new Error(err));
        });
};

ControllerPandora.prototype.seek = function (timepos) {
    this.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerPandora::seek to ' + timepos);

    //return this.sendSpopCommand('seek '+timepos, []);
};

// Stop
ControllerPandora.prototype.stop = function () {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerPandora::stop');
    return self.mpdPlugin.sendMpdCommand('stop', []);
};

// Spop pause
ControllerPandora.prototype.pause = function () {
    var self = this;
    
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerPandora::pause');
    
    if (self.state.status === 'play') { // we are pausing

        if (self.timer) {
            self.timer.pause();
        }
        return self.mpdPlugin.sendMpdCommand('pause', [])
            .then(function () {
                self.state = self.mpdPlugin.getState();
                self.state.status = 'pause';
                self.commandRouter.servicePushState(self.state, self.servicename);
                return libQ.resolve();
            });
    }
    else { // we are resuming
        
        // seek back 1 sec to prevent mpd crashing on resume of a paused stream
        var fixMpdCrashCmds = [
            { command: 'seekcur', parameters: ['-1'] },
            { command: 'play', parameters: [] }
        ];
        return self.mpdPlugin.sendMpdCommandArray(fixMpdCrashCmds)
            .then(function () {
                if (self.timer) {
                    self.timer.resume();
                }
                self.state.status = 'play';
                self.commandRouter.servicePushState(self.state, self.servicename);
                return libQ.resolve();
            });
    }
};

ControllerPandora.prototype.next = function () {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerPandora::next');

    // This changes everything.  I think we need a class variable for songsArray.
    
    // self.songsArray.shift(); // shift one song. adios, muchacho.
    // self.timer.clear();
    // self.playNextTrack(skip = true); // skip pulls a fresh track if needed

    // UNLESS we start from scratch with a new queue.
    // Seems like a bad thing to do.
    
    return self.getTracks(self.maxSongs)
        .then(function (tracks) {
            self.songsArray = tracks;
            return self.clearAddPlayTrack(tracks);
        });

};

// Get state
ControllerPandora.prototype.getState = function () {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerPandora::getState');


};

//Parse state
ControllerPandora.prototype.parseState = function (sState) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerPandora::parseState');

	//Use this method to parse the state and eventually send it with the following function
};

// Announce updated State
ControllerPandora.prototype.pushState = function (state) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerPandora::pushState');

	return self.commandRouter.servicePushState(state, self.servicename);
};

ControllerPandora.prototype.explodeUri = function (uri) {
	var self = this;
	//var defer=libQ.defer();

    // Mandatory: retrieve all info for a given URI
    var matches = uri.match(/pandora\/stations\/\?id=(\d+)/);
    self.currStation = {id: matches[1], name: self.stationList[matches[1]]};
    
    self.commandRouter.pushToastMessage('info', 'Pandora Station Selected',
                                                'Loading ' + self.currStation.name);

    return self.getTracks(self.maxSongs)
        .then(function(result) {
            self.songsArray = result;
            
            var response = [];
            response.push({
                service: self.servicename,
                type: 'mywebradio',
                trackType: 'mp3',
                //name: self.songsArray[0].title,
                //title: self.songsArray[0].title,
                //artist: self.songsArray[0].artist,
                //albumart: self.songsArray[0].albumart,
                //uri: self.songsArray[0].uri,
                //duration: self.songsArray[0].duration,
                name: self.currStation.name,
                albumart: '/albumart?sourceicon=music_service/pandora/pandora.png',
                uri: uri,
                duration: 1000,
                samplerate: '44.1 KHz',
                bitdepth: '16 bit',
                channels: 2
            });

            return libQ.resolve(response);
        });

    // var response = {
    //     service: self.servicename,
    //     type: 'track',
    //     trackType: 'mp3',
    //     name: self.currStation.name,
    //     title: self.currStation.name,
    //     albumart: '/albumart?sourceicon=music_service/pandora/pandora.png',
    //     uri: uri,
    //     duration: 1000,
    // };

	// defer.resolve(response);

    // return defer.promise;
};

ControllerPandora.prototype.getAlbumArt = function (data, path) {

	var artist, album;

	if (data != undefined && data.path != undefined) {
		path = data.path;
	}

	var web;

	if (data != undefined && data.artist != undefined) {
		artist = data.artist;
		if (data.album != undefined)
			album = data.album;
		else album = data.artist;

		web = '?web=' + nodetools.urlEncode(artist) + '/' + nodetools.urlEncode(album) + '/large';
	}

	var url = '/albumart';

	if (web != undefined)
		url = url + web;

	if (web != undefined && path != undefined)
		url = url + '&';
	else if (path != undefined)
		url = url + '?';

	if (path != undefined)
		url = url + 'path=' + nodetools.urlEncode(path);

	return url;
};





ControllerPandora.prototype.search = function (query) {
	var self=this;
	var defer=libQ.defer();

	// Mandatory, search. You can divide the search in sections using following functions

	return defer.promise;
};

ControllerPandora.prototype._searchArtists = function (results) {

};

ControllerPandora.prototype._searchAlbums = function (results) {

};

ControllerPandora.prototype._searchPlaylists = function (results) {


};

ControllerPandora.prototype._searchTracks = function (results) {

};

ControllerPandora.prototype.pandoraLogin = function () {
    // Login with pandora anesidora object
    var self = this;
    var defer = libQ.defer();
    self.pandora.login(defer.makeNodeResolver());

    return defer.promise;
};

ControllerPandora.prototype.pandoraUserGetStationList = function () {
    // Retrieve a raw Pandora station list object
    var self = this;
    var defer = libQ.defer();
    self.pandora.request('user.getStationList', defer.makeNodeResolver());

    return defer.promise;
};


ControllerPandora.prototype.pandoraStationGetPlaylist = function (stationList, stationId) {
    // Retrieve a raw Pandora playlist from a Pandora station index
    var self = this;
    var defer = libQ.defer();
    var station = stationList.stations[stationId];

    self.pandora.request('station.getPlaylist', {
        'stationToken': station.stationToken,
        'additionalAudioUrl': 'HTTP_128_MP3',
        'includeTrackLength': true
        }, defer.makeNodeResolver());

    return defer.promise;
};

ControllerPandora.prototype.getSongsFromPandoraPlaylist = function (playlist, numSongs) {
    // Retrieve an array of songs we can use from a raw Pandora playlist
    var defer = libQ.defer();
    var response = [];
    for (var i = 0; i < numSongs; i++) {
        var track = playlist.items[i];
        console.log('loop: ' + i + ' max: ' + numSongs);
        response.push({
            service: 'pandora',
            type: 'song',
            title: track.songName,
            artist: track.artistName,
            album: track.albumName,
            albumart: track.albumArtUrl,
            duration: track.trackLength,
            uri: track.additionalAudioUrl,
            samplerate: '44.1 KHz',
            bitdepth: '16 bit',
            channels: 2
        });
    }
    defer.resolve(response);

    return defer.promise;
};

ControllerPandora.prototype.pushSongState = function (song) {
    var self = this;

    return self.mpdPlugin.getState()
        .then(function (state) {
            var mpdState = state;

            mpdState.albumart = song.albumart;
            mpdState.title = song.title;
            mpdState.artist = song.artist;
            mpdState.album = song.album;

            return self.commandRouter.servicePushState(mpdState, self.servicename);
        });
    
    // var pState = {
    //     status: 'play',
    //     service: self.servicename,
    //     type: 'track',
    //     trackType: 'mp3',
    //     //radioType: self.servicename,
    //     albumart: song.albumart,
    //     uri: song.uri,
    //     title: song.title,
    //     artist: song.artist,
    //     album: song.album,
    //     streaming: true, 
    //     disableUiControls: true,
    //     duration: song.duration,
    //     seek: 0,
    //     samplerate: '44.1 KHz',
    //     bitdepth: '16 bit',
    //     channels: 2
    // };

    // self.state = pState;

    // //workaround to allow state to be pushed when not in a volatile state
     
    // var vState = self.commandRouter.stateMachine.getState();
    // var queueItem = self.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];

    // queueItem.name = song.title;
    // queueItem.title = song.title;
    // queueItem.artist = song.artist;
    // queueItem.album = song.album;
    // queueItem.albumart = song.albumart;
    // queueItem.trackType = self.servicename;
    // queueItem.duration = song.duration;
    // queueItem.samplerate = '44.1 KHz';
    // queueItem.bitdepth = '16 bit';
    // queueItem.channels = 2;
    
    // //reset volumio internal timer
    // self.commandRouter.stateMachine.currentSeek = 0;
    // self.commandRouter.stateMachine.playbackStart=Date.now();
    // self.commandRouter.stateMachine.currentSongDuration=song.duration;
    // self.commandRouter.stateMachine.askedForPrefetch=false;
    // self.commandRouter.stateMachine.prefetchDone=false;
    // self.commandRouter.stateMachine.simulateStopStartDone=false;
    

    // //volumio push state
    // self.commandRouter.servicePushState(pState, self.servicename);
};

ControllerPandora.prototype.getTracks = function (numSongs) {
    var self = this;
    return self.pandoraLogin()
        .fail(function (err) {
            self.logger.error('[Pandora] Login error: ' + err);
            return libQ.reject('[Pandora] Login error: ' + err);
        })
        .then(function () {
            return self.pandoraUserGetStationList();
        })
        .fail(function (err) {
            self.logger.error('[Pandora] Error getting station list: ' + err);
            return libQ.reject('[Pandora] Error getting station list: ' + err);
        })
        .then(function (stationList) {
            return self.pandoraStationGetPlaylist(stationList, self.currStation.id);
        })
        .fail(function (err) {
            self.logger.error('[Pandora] Error getting playlist: ' + err);
            return libQ.reject('[Pandora] Error getting playlist: ' + err);
        })
        .then(function (playlist) {
            return self.getSongsFromPandoraPlaylist(playlist, numSongs); //could not extract from here
        })
        .fail(function (err) {
            self.logger.error('[Pandora] Error getting songs from playlist: ' + err);
            return libQ.reject('[Pandora] Error getting songs from playlist: ' +err);
        });
};

ControllerPandora.prototype.playNextTrack = function (songs) {
    var self = this;
    var songsArray = songs;
    
    function setTimer() {
        // calculate time of next track + delay
        // song length error is +/- 1 sec, so 500 + another 500 for lag
        var duration = songsArray[0].duration * 1000 + 1000;
        self.logger.info('[' + Date.now() + '] ' +
            '[Pandora] Setting timer to: ' + duration + ' milliseconds.');

        songsArray.shift();
        self.songsArray = songsArray;
         // You go back, Jack.  Do it again... (Steely Dan)
         // And now we're back where we started.  Here we go round again... (The Kinks)
        self.timer = new PandoraTimer(self.playNextTrack.bind(self), [songsArray], duration);
    }

    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerPandora::playNextTrack');
    
    self.mpdPlugin.sendMpdCommand('add "' + songsArray[0].uri + '"', [])
        .then(function () {
            self.mpdPlugin.sendMpdCommand('play', []);
        })
        // .then(function () {
        //     return self.mpdPlugin.getState();
        // })
        // .then(function (state) {
        //     //self.commandRouter.stateMachine.syncState(state, self.servicename);
        //     self.commandRouter.servicePushState(state, self.servicename);
        // })
        .then(function () {
            self.pushSongState(songsArray[0]); // push the current song state
            self.logger.info('[' + Date.now() + '] ' +
                    '[Pandora] Playing Track =>' +
                    ' Artist: ' + songsArray[0].artist +
                    ' Title: ' + songsArray[0].title);
            self.commandRouter.pushToastMessage('info',
                    'Pandora Playing Track',
                    'Artist: ' + songsArray[0].artist +
                    ' Song: ' + songsArray[0].title);
            if (songsArray.length === 1) { // feed me! (last track)
                self.getTracks(self.maxSongs)
                    .then(function (newSongs) {
                        songsArray = songsArray.concat(newSongs); // append new songs
                        self.songsArray = self.songsArray.concat(newSongs); // redundant will fix later
                        
                        setTimer();
                    });
            }
            else { // still have a few more songs
                setTimer();
            }
        });
};

function PandoraTimer(callback, args, delay) {
    var start, remaining = delay;

    var nanoTimer = new NanoTimer();

    PandoraTimer.prototype.pause = function () {
        nanoTimer.clearTimeout();
        remaining -= new Date() - start;
    };

    PandoraTimer.prototype.resume = function () {
        start = new Date();
        nanoTimer.clearTimeout();
        nanoTimer.setTimeout(callback, args, remaining + 'm');
    };

    PandoraTimer.prototype.clear = function () {
        nanoTimer.clearTimeout();
    };

    this.resume();
}
