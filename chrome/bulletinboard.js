
(function() {
    'use strict';
    
	//var cs = new ConfigurationSet();
	
	var ukey = Universe.getServer ( document ).substr( 0, 1 );	
	var premium = true, missions;
    
	var missionDiv = document.getElementById( 'missions' );
    if ( !missionDiv ) {
        premium = false;
    }
    if ( premium ) {
        missions = missionDiv.getElementsByTagName( 'tbody' )[0].childNodes;
    } else {
        missions = document.getElementById( 'div_missions' ).getElementsByTagName( 'table' );
    }

    for( var i = 1; i < missions.length; i++) {
        let a = missions[i].getElementsByTagName( 'a' );		
		a[ a.length - 1 ].addEventListener( 'click', clickedMission.bind( missions[i], premium ) );
    }

	function clickedMission( premium ) {
		var mission = parseMission( this, premium );
		let get = [ ukey + 'm' + mission.locId, ukey + 'mlist' ];
		chrome.storage.local.get( get, storeMission.bind( null, mission ) );
	}
	
    function storeMission( mission, data ) {
		// We get the mission data from the earlier derived variables.

		if ( !data[ ukey + 'mlist' ] ) {
			// first time, let's be gentle.
			data[ ukey + 'mlist' ] = [];
		}
		
		if (!data[ ukey + 'm' + mission.locId ]) {
			// New mission to this location!
			mission.total = 1;
			data[ ukey + 'm' + mission.locId ] = mission;
			data[ ukey + 'mlist' ].push( mission.locId );
		} else if ( mission.locId !== -1 ) {
			// yay stacking targetted missions!
			data[ ukey + 'm' + mission.locId ].reward += mission.reward;
			data[ ukey + 'm' + mission.locId ].deposit += mission.deposit;
			data[ ukey + 'm' + mission.locId ].total += 1;
		} else {
			// stacking untargetted missions WIP.
		}
		chrome.storage.local.set( data );
	}
		
	function parseMission( mission, premium ) {
        var output = new Object();
        if ( premium ) {
            var data = mission.getElementsByTagName( 'td' );
            // console.log(data);
            output[ 'faction' ] = data[0].firstChild.src;
            output[ 'faction' ] === undefined ? output[ 'faction' ] = 'n' : output[ 'faction' ] = output[ 'faction' ].split( /\//g )[ 6 ][ 5 ];//check for neutral vs faction.
            output[ 'type' ] = data[1].firstChild.title[ 0 ];
            output[ 'timeLimit'] = parseInt( data[3].textContent );
            output[ 'sector'] = data[5].textContent;
			if ( output.sector !== '-' ) {  
				output[ 'coords'] = data[6].textContent.split( /[\[,\]]/g );
				output[ 'coords'] = { 'x': parseInt( output[ 'coords'][1] ), 'y': parseInt( output[ 'coords'][2] ) }; //split coords in x and y.
				output[ 'locId' ] = Sector.getLocation( Sector.getId( output.sector ), output.coords.x, output.coords.y );
			} else {
				output[ 'locId' ] = -1;
			}
			output[ 'image' ] = data[1].firstChild.src;
            output[ 'reward'] = parseInt( data[7].textContent.replace(/,/g,'') );
            output[ 'deposit'] = parseInt( data[8].textContent.replace(/,/g,'') );
            output[ 'id' ] = data[9].firstChild.id;
        } else {

        }

        return output
    }
})();