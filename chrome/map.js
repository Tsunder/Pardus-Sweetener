// This object implements graphics we need to display maps and
// minimaps.
//
// No, we don't use HTML tables for those.  That would be much easier,
// and in fact we tried it first, but problem is: there are big
// sectors in Pardus.  The Pardus Core itself is nearly 100x100 tiles
// - which means that, rendered as a table, it requires us to insert
// 10,000 nodes in the DOM tree.  Now Chrome is fast, but that's just
// evil, it would bring any browser down to its knees.  And it does.
// And the last thing you need is to spend half your CPU drawing a
// minimap, when you need to be navving or whatever.
//
// And so, since it's 2013 and that, we use the HTML5 Canvas.

'use strict';

function SectorMap() {}
SectorMap.prototype = {

	configure: function( sector, maxPixelSize ) {
		this.sector = sector;
		this.ukey = Universe.getServer ( document ).substr( 0, 1 );
        // `savedPath` is the path saved in this script, used to plot the 
        // route you might take and are investigating with your mouse.
        // `storedPath` is the path you decide to follow, by clicking the mouse,
        // and this subsequently *stored* in chrome.storage. This path is 
        // displayed on the nav area.
        this.savedPath = [];
        this.storedPath = [];
        this.TCCData = {};
        this.TCCLength = 0;
        this.TCCSectors = {};
        this.TCCPath = [];
        this.TCCWHcost = { 'wh': 10, 'xh': 1000 };
        this.travelCostCalculator();

		var cols = sector.width, rows = sector.height, tiles = sector.tiles;

		if ( tiles.length != cols*rows ) {
			throw new Error( "Tile data and map dimensions do not match" );
		}

		if ( cols > rows ) {
			// This is a wide map. We use cols to determine
			// size. Height will be less than required.
			this.computeGrid( cols, maxPixelSize );
		}
		else {
			// A tall map, use rows instead.
			this.computeGrid( rows, maxPixelSize );
		}

		if ( this.grid ) {
			this.width = cols * ( this.tileSize + 1 ) - 1;
			this.height = rows * ( this.tileSize + 1 ) - 1;
		}
		else {
			this.width = cols * this.tileSize;
			this.height = rows * this.tileSize;
		}
		this.cols = cols;
		this.rows = rows;
		this.configured = true;
		
		//mouseover support
		this.mouseX = -1;
		this.mouseY = -1;
		this.shipX = -1;
		this.shipY = -1;
		this.mouselock = false;

		if ( this.canvas ) {
			this.initCanvas();
		}
		
        // re-adding stored path to our map.
        chrome.storage.local.get( [ this.ukey + 'storedPath' ], getPath.bind( this ) );     
        function getPath( data ) {
            if ( data[ this.ukey + 'storedPath' ] ) {
               for ( var i = 0; i < data[ this.ukey + 'storedPath' ].length; i++ ) {
                    let coords = Sector.getCoords( 
                            Sector.getId( this.sector.sector ),
                            data[ this.ukey + 'storedPath' ][i] );
                    this.storedPath.push ( [coords.x, coords.y] );
                }
            }
            this.drawSavedPath( this.get2DContext(), this.storedPath );
        }

        // I don't recall why we don't use ukey here. Might fix that later.
		var universe = Universe.getServer( document );
		chrome.storage.local.get( [ universe + 'advSkills' ], setVisc.bind( this, universe ) );
		function setVisc( universe, data ) {
			var VISC = { 
				'f': 11, // fuel -> space
				'g': 16, // nebula gas
				'v': 18,
				'e': 20,
				'o': 25, // ore -> asteriods
				'm': 36  // Exotic Matter
			};
			
			// Parsing Navigation adv. skill.
			if ( data[ universe + 'advSkills' ] ) { // checking if it's set first 
				if ( data[ universe + 'advSkills' ][41] > 0 ) {
					VISC[ 'o' ] -= 1;
				}
				if ( data[ universe + 'advSkills' ][41] > 1 ) {
					VISC[ 'g' ] -= 1;
				}
				if ( data[ universe + 'advSkills' ][41] > 2 ) {
					VISC[ 'e' ] -= 1;
				}
				this.Navigation = data[ universe + 'advSkills' ][41]; // saving the number for our speed calculation later
			} else {
				this.Navigation = 0;
			}
			this.VISC = VISC;
		}
		
	},

	setCanvas: function( canvas, div ) {
		this.canvas = canvas;
		this.distanceDiv = div;
		
		if ( this.configured ) {
			this.initCanvas();
		}
	},
	
	//attach events for mouseover path calculation
	enablePathfinding: function() {
		this.attachMouseEvents(this.canvas);
		this.distanceDiv.style.display = "block";
	},

	// Just gets the 2D context of the canvas. You'll want this to
	// clear the map and mark tiles.
	get2DContext: function() {
		return this.canvas.getContext( '2d' );
	},

	// This "clears" the canvas, restoring the sector map. So this
	// effectively draws the sector map. The idea being: you'll want
	// to clear, then overlay dynamic stuff on the "background" map.
	clear: function( ctx ) {
		ctx.drawImage( this.bgCanvas, 0, 0 );
		this.distanceDiv.innerHTML = "&nbsp;<br>&nbsp;";
//		if (this.mouselock) {
			this.drawSavedPath(ctx, this.storedPath );
	//	}
    },

	// This draws a marker on a tile.
	markTile: function( ctx, col, row, style ) {
		var grid = this.grid, size = this.tileSize,
			gstep = grid ? size+1 : size, x = col*gstep, y = row*gstep;

		// If the tiles are large enough, make the mark smaller so
		// the background shows a bit, let you know what type of tile
		// the marker is on.
		if ( size > 10 ) {
			x += 2;
			y += 2;
			size -= 4;
		}
		else if ( size > 5 ) {
			x += 1;
			y += 1;
			size -= 2;
		}

		ctx.fillStyle = style;
		ctx.fillRect( x, y, size, size );
	},
	
	// This draws the saved path, for if we navigate with the minimap locked
	drawSavedPath: function ( ctx, path ) {
        if (!path) {
            this.savedPath.forEach(function (e) {
                this.markTile(ctx, e[0], e[1], "#080");
            }.bind(this));
        } else {
            path.forEach(function (e) {
            this.markTile(ctx, e[0], e[1], "#880");
            }.bind(this));
        }
	},

	// This sets the current ship coords, for navigation
	setShipCoords: function( col, row ) {
		this.shipX = col;
		this.shipY = row;
	},
	
	// This marks the current ship tile
	markShipTile: function( ctx ) {
		this.markTile( ctx, this.shipX, this.shipY, '#0f0' );
	},

	// Convert pixel x,y coordinates on the canvas to map row,col.
	// For this purpose, if the map has a grid, points on the grid are
	// assumed to belong on the tile to the right/bottom. 
	xyToColRow: function( x, y ) {
		var gstep = this.grid ? this.tileSize+1 : this.tileSize;
		
		x = Math.floor( x / gstep );
		y = Math.floor( y / gstep );
		
		if (y < 0 || y >= this.sector.height || x < 0 || x >= this.sector.width) return null;
		return { x: x, y: y };
	},


	// Below is "private" stuff which you shouldn't need to use from
	// outside this object.

	COLOUR: {
		b: '#158',	// hard energy
		e: '#0e2944', // energy
		f: '#000',	// fuel
		g: '#a00',	// gas
		m: '#0c0',	// exotic matter
		o: '#666',	// ore
		v: '#ee0'	 // viral
	},
	
	initCanvas: function() {
		this.canvas.width = this.width;
		this.canvas.height = this.height;
		// We actually paint most of the map here
		this.setupBgCanvas();
	},

	setupBgCanvas: function() {
		var doc = this.canvas.ownerDocument;
		if ( !doc ) {
			// We can't draw anyway
			return;
		}

		var ctx, x, y, px0, row, col,
			rows = this.rows, cols = this.cols, c,
			sector = this.sector, data = sector.tiles,
			width = this.width, height = this.height,
			size = this.tileSize, grid = this.grid,
			colour = this.COLOUR, canvas = doc.createElement( 'canvas' );

		canvas.width = width;
		canvas.height = height;
		this.bgCanvas = canvas;

		ctx = canvas.getContext( '2d' );

		if ( grid ) {
			// When the grid is enabled, we paint tiles of side
			// size+1. The extra pixel is really part of the grid
			// line, but painting in the tile colour first makes the
			// map prettier.
			size += 1;

			// Since there is one less grid line than there are rows
			// (or columns), one of these "tile plus grid pixel" areas
			// has to be 1px smaller.  We feel it looks better if this
			// is the first row and the first column.  So we paint 1px
			// up and to the left, and let the canvas clip it.
			px0 = -1;
		}
		else {
			px0 = 0;
		}

		for ( row = 0, y = px0; row < rows; row++, y += size ) {
			for ( col = 0, x = px0; col < cols; col++, x += size ) {
				c = data[ row*cols + col ];
				ctx.fillStyle = colour[ c ];
				ctx.fillRect( x, y, size, size );
			}
		}

		if ( grid ) {
			ctx.fillStyle = 'rgba(128, 128, 128, 0.25)';
			for ( y = size-1; y < height; y += size ) {
				ctx.fillRect( 0, y, width, 1 );
			}
			for ( x = size-1; x < width; x += size ) {
				ctx.fillRect( x, 0, 1, height );
			}
		}

		// Paint beacons
		for ( var beacon_name in sector.beacons ) {
			var beacon = sector.beacons[ beacon_name ], style;
			switch ( beacon.type ){
			case 'wh':
				style = '#c6f';
				break;
			default:
				style = '#fff';
			}
			this.markTile( ctx, beacon.x, beacon.y, style );
		}
	},
	
	//attach the mouse events for path calculation
	attachMouseEvents: function (canvas) {
		canvas.addEventListener('click', function (e) {
			//lock if unlocked, unlock and clear if locked
			if (this.mouselock) {
				this.clear(this.get2DContext());
				this.markShipTile(this.get2DContext());
				chrome.storage.local.remove( [ this.ukey + 'storedPath' ] );
			} else {		
				let save = {};
				save[ this.ukey + 'storedPath' ] = [];
				for ( var i = 0; i < this.savedPath.length; i++ ) {
					save[ this.ukey + 'storedPath' ].push (
						Sector.getLocation( 
							Sector.getId( this.sector.sector ) ,
							this.savedPath[ i ][ 0 ],
							this.savedPath[ i ][ 1 ] )
							);
				}
				chrome.storage.local.set( save );
			}
			this.mouselock = !this.mouselock;
		}.bind(this));
		
		['mousemove', 'click'].forEach(function (evt) {
			canvas.addEventListener(evt, function (e) {
				//determine client location, and calculate path to it if needed
				if (this.mouselock) return;
				
				var rect = canvas.getBoundingClientRect(), 
					scaleX = canvas.width / rect.width, 
					scaleY = canvas.height / rect.height;
				var loc = this.xyToColRow((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
				if (!loc) return;
				
				if (loc.x != this.mouseX || loc.y != this.mouseY) {
					this.drawPath(loc);
	
					//if there's a waypoint, why not draw it
					for (var n in this.sector.beacons) {
						var e = this.sector.beacons[n];
						if (e.x == loc.x && e.y == loc.y)
							this.distanceDiv.innerHTML += (e.type == "wh" ? "Wormhole to " : "") + n;
					}
				}
			}.bind(this));
		}.bind(this));
		
		canvas.addEventListener('mouseout', function (e) {
			//clear the map when mouse leaves it
			if (this.mouselock) return;
			
			this.clear(this.get2DContext());
			this.markShipTile(this.get2DContext());
			this.mouseX = -1;
			this.mouseY = -1;
		}.bind(this));
	},
	
	// draw the path from the current ship location to the mouse location, 
	// and calculate AP costs for it via planPath.
	drawPath: function( loc ) {
		this.clear(this.get2DContext());
		this.markShipTile(this.get2DContext());
		
		let path = this.planPath( loc, {'x': this.shipX, 'y': this.shipY }, this.sector );
        this.savedPath = path.path;
        
		this.drawSavedPath(this.get2DContext());
		this.markShipTile(this.get2DContext());
		this.distanceDiv.innerHTML = "Distance to " + this.sector.sector 
            + " [" + loc.x + ", " + loc.y + "]: " 
            + path.apsSpent 
            + " APs<br>&nbsp;"; //innerHTML to accomodate infinity symbol
		
	},
    
    getSpeed: function() {
        // function calculates speed (as in the Pardus Manual), allowing for 
        // boost, stims, etc. XXX still needs to be tested with legendary.
        
        let currentTileType = this.sector.tiles[ this.shipX 
            + this.sector.width * this.shipY ];
        let moveField = document.getElementById('tdStatusMove').childNodes;
        let speed = 0;
        if ( moveField.length > 1 ) { //something modifies our speed 
            speed -= parseInt( moveField[1].childNodes[0].textContent );
        }
        speed -= parseInt( moveField[0].textContent );
        speed += this.VISC[ currentTileType ];
        
        if ( ( this.Navigation == 1 && currentTileType == 'o' )
            || ( this.Navigation == 2 && currentTileType == 'g' )
            || ( this.Navigation == 3 && currentTileType == 'e' ) ) {
                speed += 1;
            }
        return speed;
    },
        
    // In planPath, we do a BFS across the entire sector with respect to the 
    // cost, stopping when either the state is the same for 100 AP's 
    // (unreachable) or we've reached the location.
    // loc and fromLoc are both a dictionary with x and y as keys, sector is the 
    // sector (see /map/ and onwards for examples).
    planPath: function( loc, fromLoc, sector ) {
        // first get the travel costs per tile type: tc
        let speed = this.getSpeed();
        var tc = { 
			b: -1,
			'f': this.VISC[ 'f' ] - speed, // fuel -> space
			'g': this.VISC[ 'g' ] - speed, // nebula gas
			'v': this.VISC[ 'v' ] - speed,
			'e': this.VISC[ 'e' ] - speed,
			'o': this.VISC[ 'o' ] - speed, // ore -> asteriods
			'm': this.VISC[ 'm' ] - speed  // Exotic Matter
		};
        
        var i,j;
        var bfsState = [];
        var costFromTile = []; //quickly lookup the cost of travelling from any tile, without string fluffery
        
        for  ( i=0; i<sector.height; i++ ) {
            bfsState.push([]);
            costFromTile.push([]);
            for ( j=0 ; j<sector.width; j++) {
                bfsState[i].push([-1, -1, -1]); //[previous X, previous Y, distance]
                costFromTile[i].push(~~tc[sector.tiles.charAt(i * sector.width + j)]);
            }
        }
        bfsState[fromLoc.y][fromLoc.x] = [0, fromLoc.y, fromLoc.x]; //mark current location as zero distance
        
        var apsSpent = 0;
        //if current tile is unreachable, then lol
        if (costFromTile[loc.y][loc.x] == -1) {
            apsSpent = "&infin;";
            return { 'path': [[loc.x, loc.y]], 'apsSpent': apsSpent };           
        }
            
        var unreachableCounter = 0; //reset on map state change, incremented on 1AP spent, marked unreachable when it reaches 100
        while (unreachableCounter < 100) {
            //copy bfsState
            var nextBfsState = [];
            for (i=0;i<sector.height;i++) {
                nextBfsState.push([]);
                for (j=0;j<sector.width;j++) nextBfsState[i].push(bfsState[i][j].slice());
            }
            
            for (i=0;i<sector.height;i++) { 
                for (j=0;j<sector.width;j++) {
                    if (bfsState[i][j][0] == -1) 
                        continue; //not visited yet
                    
                    var processPath = function (curX, curY, nextX, nextY, isDiagonal) { //isDiagonal is used to favor non-diagonal movement when costs are equal, because humans click those easier
                        if (nextX < 0 || nextX >= sector.height || nextY < 0 || nextY >= sector.width) return;
                        
                        var cost = bfsState[curX][curY][0] + costFromTile[curX][curY];
                        if (costFromTile[nextX][nextY] == -1) return; //the way is blocked, cannot go
                        if (cost > apsSpent) return; //too much cost currently
                        
                        if (nextBfsState[nextX][nextY][0] == -1 || nextBfsState[nextX][nextY][0] > cost || (nextBfsState[nextX][nextY][0] == cost && !isDiagonal)) {
                            nextBfsState[nextX][nextY] = [cost, curX, curY];
                            if (nextBfsState[nextX][nextY].join(",") != bfsState[nextX][nextY].join(","))
                                unreachableCounter = 0;
                        }
                    }.bind(this);
                    
                    for (var m=-1; m<2;m++) {
                        for (var n=-1; n<2;n++) {
                            if ( m===0 && n===0 )
                                continue; // skip 0,0
                            processPath(i, j, i+m, j+n, Math.abs(m)===Math.abs(n) );
                        }
                    }
                }
            }
            
            bfsState = nextBfsState;
            
            /* //uncomment to debug
            var d = "";
            for (i=0;i<this.sector.height;i++) {
                for (j=0;j<this.sector.width;j++) {
                    d += bfsState[i][j][0] + "\t";
                }
                d += "\n"
            }
            console.log(d);
            //*/
            
            //break if we've found a path
            if (bfsState[loc.y][loc.x][0] != -1) break;
            
            unreachableCounter++;
            apsSpent++;
            
            if (apsSpent >= 10000) break; //sanity check
        }
    
        
        var endState = bfsState[loc.y][loc.x];
        if (endState[0] == -1) {
            apsSpent = "&infin;";
            return { 'path': [[loc.x, loc.y]], 'apsSpent': apsSpent };
        } else {
            //if we have found a path, we know it's min length because all the previous iterations did not end here.
            //now we iterate backwards until we get to the ship
            i = loc.y;
            j = loc.x;
            var path = [];
            var sanityCheck = 0;
            while (!(i == fromLoc.y && j == fromLoc.x) && sanityCheck++ < 10000) {
                path.push([j, i]);
                var state = bfsState[i][j];
                i = state[1];
                j = state[2];
            }
            path.push([fromLoc.x, fromLoc.y]);
            return { 'path': path, 'apsSpent': apsSpent };
        }
    },
        
	// Compute the tile size and whether we'll draw grid lines.
	//
	// The aim is to fit the given number of tiles in the given number
	// of pixels.  Our tiles are square, so we only really compute
	// this for one dimension.
	//
	// Our tiles are of uniform size. This means we don't really
	// output a map of the requested dimensions, but the largest size
	// we can create, while keeping our cells square and uniform size,
	// that is still less than or equal than the specified pixel size.
	//
	// We want thin 1px grid lines if the tiles are big enough. When
	// the map is so large that the tiles become tiny, we don't want
	// to waste pixels in those.
	computeGrid: function( tiles, maxPixels ) {
		if ( !( tiles > 0 && maxPixels > 0 ) ) {
			throw new Error( 'Invalid parameters' );
		}

		if ( tiles > maxPixels ) {
			throw new Error( 'Cannot draw ' + tiles + ' tiles in ' +
							 maxPixels + ' pixels');
		}

		var grid, size = Math.floor( (maxPixels + 1) / tiles );

		// A tile would be size-1 pixels per side, the extra pixel is
		// for the grid. All our tiles fit in the allowed pixels
		// because there is one less grid line than there are tiles.
		if ( size < 4 ) {
			// This means our tiles would be 2 pixels per side. We
			// don't want grid lines in this case.
			size = Math.floor( maxPixels / tiles );
			grid = false;
		}
		else {
			size -= 1;
			grid = true;
		}

		this.tileSize = size;
		this.grid = grid;
	},
    
    travelCostCalculator: function() {
        var div = document.createElement( 'div' );
        var selectNode = document.createElement( 'select' );
        selectNode.id = 'sweetener-TCC-sector';
        div.textContent = 'Travel to: ';
        div.appendChild( selectNode );
        var cat = Sector.getCatalogue(), opt;
        for ( var i = 1; i < cat.length; i++ ) {
            opt = document.createElement( 'option' );
            if ( i === 0 ) {
                opt.text = 'Where to?';
            } else {
                opt.text = cat[i].n;
            }
            selectNode.add( opt );
        }
        selectNode.value = 'Iozeio';//'Zeaex';
        this.distanceDiv.parentNode.appendChild( div );
        // selectNode.addEventListener( 'change', chosenSector );
        // function chosenSector() {
            let br = document.createElement( 'br' );
            let x = document.createElement( 'input' );
            x.type = 'number';
            x.max = 100;
            x.value = 10;//5;
            x.setAttribute( 'style', 'width: 3em');
            x.id = 'sweetener-TCC-x';
            let y = document.createElement( 'input' );
            y.type = 'number';
            y.max = 100;
            y.value = 10;//2;
            y.setAttribute( 'style', 'width: 3em');
            y.id = 'sweetener-TCC-y';
            div.appendChild( br );
            div.appendChild( x );
            div.appendChild( y );
            // y.addEventListener( 'change', chosenCoords );
        // }
        // function chosenCoords() { //change br to let br below when uncommenting
            let btn = document.createElement( 'button' );
            btn.textContent = 'plan';
            br = document.createElement( 'br' );
            div.appendChild( br );
            div.appendChild( btn );
        // }
        
        btn.addEventListener( 'click', function() {
            chrome.runtime.sendMessage( { requestMap: 'Universe' }, calcPath.bind(this) ) 
        }.bind(this) );
        
        function calcPath( universeMap ) {
            this.toSector = document.getElementById( 'sweetener-TCC-sector' ).value;
            this.toLoc = {
                'x': parseInt(document.getElementById( 'sweetener-TCC-x' ).value),
                'y': parseInt(document.getElementById( 'sweetener-TCC-y' ).value)
                };
                
            let r = ( 
                    ( universeMap[ this.toSector ].x 
                        - universeMap[ this.sector.sector ].x )**2 
                    + 
                    ( universeMap[ this.toSector ].y 
                        - universeMap[ this.sector.sector ].y )**2 
                ) ** (1/2);
            
            let sectors = Object.keys( universeMap );
            // get the sectors that are close, to save computation time.
            /*.filter( 
                function( value, index, arr ) {
                    let dfrom = ( 
                        ( universeMap[ value ].x 
                            - universeMap[ this.sector.sector ].x )**2 
                        + 
                        ( universeMap[ value ].y 
                            - universeMap[ this.sector.sector ].y )**2 
                        ) ** (1/2);
                    let dto = ( 
                        ( universeMap[ value ].x 
                            - universeMap[ this.toSector ].x )**2 
                        + 
                        ( universeMap[ value ].y 
                            - universeMap[ this.toSector ].y )**2 
                        ) ** (1/2);
                    return ( dfrom < r  || dto < r  )
                }.bind(this) );*/
            
            this.TCCLength = sectors.length;
            for (var i = 0; i< sectors.length; i++) {
                chrome.runtime.sendMessage( { requestMap: sectors[i] }, getData.bind(this) );
            }          
        }

        function getData ( sector ) {
            this.TCCData[ sector.sector ] = sector;
			this.TCCData[ sector.sector ].distance = Infinity;
			this.TCCData[ sector.sector ].visited = false;
			this.TCCData[ sector.sector ].path = [];
            // this.TCCData[ sector.sector ].jumps = 0;
            if ( Object.keys(this.TCCData).length === this.TCCLength ) {
                specialTreatment.call(this);
                gotData.call(this);
            }
        }
        
        function gotData() {
            /* 1. 
            Mark all nodes unvisited. Create a set of all the unvisited nodes called the unvisited set.
            2. Assign to every node a tentative distance value: set it to zero for our initial node and to infinity for all other nodes. Set the initial node as current.
            3. For the current node, consider all of its unvisited neighbors and calculate their tentative distances through the current node. Compare the newly calculated tentative distance to the current assigned value and assign the smaller one. For example, if the current node A is marked with a distance of 6, and the edge connecting it with a neighbor B has length 2, then the distance to B through A will be 6 + 2 = 8. If B was previously marked with a distance greater than 8 then change it to 8. Otherwise, keep the current value.
            4. When we are done considering all of the unvisited neighbors of the current node, mark the current node as visited and remove it from the unvisited set. A visited node will never be checked again.
            5. If the destination node has been marked visited (when planning a route between two specific nodes) or if the smallest tentative distance among the nodes in the unvisited set is infinity (when planning a complete traversal; occurs when there is no connection between the initial node and remaining unvisited nodes), then stop. The algorithm has finished.
            6. Otherwise, select the unvisited node that is marked with the smallest tentative distance, set it as the new "current node", and go back to step 3.
            */
            
            // console.log(this.TCCData);
            // this.TCCData[ this.sector.sector ] = this.sector;            
  			// this.TCCData[ this.sector.sector ].distance = Infinity;
			// this.TCCData[ this.sector.sector ].visited = false;
			// this.TCCData[ this.sector.sector ].path = -1;
            
            // first go from the toLoc to the wormholes.
            let currentSector = this.toSector;
            let nearestNeighborList = Object.entries( this.TCCData[ this.toSector ].beacons ).filter( 
                function( value, index, arr ) {
                    return value[1].type === 'wh' || value[1].type === 'xh'
                } );

            this.TCCData[ this.toSector ].path = [ this.toSector ];
   
            for ( var i=0; i<nearestNeighborList.length; i++ ) {
                let path = this.planPath( 
                        { 
                            'x': this.TCCData[ this.toSector ].beacons[ nearestNeighborList[i][0] ].x,
                            'y': this.TCCData[ this.toSector ].beacons[ nearestNeighborList[i][0] ].y 
                        }, this.toLoc, this.TCCData[ this.toSector ] )
                path.apsSpent += this.TCCWHcost[ this.TCCData[ this.toSector ].beacons[ nearestNeighborList[i][0] ].type ];
                this.TCCData[ nearestNeighborList[i][0] ].distance = path.apsSpent;
                this.TCCData[ nearestNeighborList[i][0] ].path.push( currentSector ); 
                // this.TCCData[ nearestNeighborList[i][0] ].jumps = 1;                
            }
            this.TCCData[ this.toSector ].visited = true;
            var previousSector = this.toSector;

            // Right, now we have the distance to the initial WHs, let's do Dijkstra Magic.
            while( !this.TCCData[ this.sector.sector ].visited ) {
                // get smallest distance node, so we remove all visited and sort
                // according to distance, and get number 0.
                currentSector = Object.entries( this.TCCData ).filter( 
                function( value ) {
                    return !value[1].visited;
                } ).sort( function( a, b ) {
                    return a[1].distance - b[1].distance;
                })[0][0];
                // let nearestNeighborList = Object.keys( this.TCCData[ currentSector ].wh )
                this.TCCData[ currentSector ].wh = processSector.call( 
                    this, this.TCCData[ currentSector ] );
                
                previousSector = this.TCCData[ currentSector ].path[ this.TCCData[ currentSector ].path.length - 1 ]; 
                console.log( 'From: ' + previousSector + ' in: ' + currentSector );
                // now update distances and path.
                let keys = Object.keys( this.TCCData[ currentSector ].wh[ previousSector ] );

                for ( let i=0; i<keys.length; i++ ) {
                console.log(keys[i]);
                    
                    if ( this.TCCData[ keys[i] ].distance 
                        > this.TCCData[ currentSector ].distance 
                            + this.TCCData[ currentSector ].wh[ previousSector ][ keys[i] ].apsSpent ) {
                        
                        this.TCCData[ keys[i] ].distance = this.TCCData[ currentSector ].distance 
                            + this.TCCData[ currentSector ].wh[ previousSector ][ keys[i] ].apsSpent;
                        this.TCCData[ keys[i] ].path = this.TCCData[ previousSector ].path.concat( previousSector, currentSector ); 
                        console.log(previousSector, this.TCCData[ previousSector ].path, this.TCCData[ keys[i] ].path);
                        }
                }
                
                // and set the sector visited, and set our current the previous.
                this.TCCData[ currentSector ].visited = true;
                previousSector = currentSector;
            }
        
        this.TCCData[ currentSector ].path.reverse().pop();
        let finalSector = this.TCCData[ currentSector ].path[0];
        console.log(finalSector);
        var finalPath = this.planPath( {
            'x': this.TCCData[ this.sector.sector ].beacons[ finalSector ].x , 
            'y': this.TCCData[ this.sector.sector ].beacons[ finalSector ].y 
            } , { 'x': this.shipX, 'y': this.shipY }, this.sector );
        console.log(  finalPath );
        div.appendChild( document.createElement( 'br' ) );
        div.appendChild( document.createTextNode (
            JSON.stringify(this.TCCData[ currentSector ].path )));
        div.appendChild( document.createElement( 'br' ) );
        div.appendChild( document.createTextNode ( 'APs: ' + 
            ( this.TCCData[ currentSector ].distance + finalPath.apsSpent ) ) );
        }
        
        function processSector( sector ) {
            var path = {};
            // get rid of non wh/xh beacons
            console.log(sector.sector, sector.beacons);
            let beacons = Object.entries( sector.beacons ).filter( 
                function( value, index, arr ) {
                    return value[1].type === 'wh' || value[1].type === 'xh'
                } );
            beacons.sort();
            
            // We calculate the from each WH to the other. Saving it as a 
            // dictionary { whname : { towhname { 'path', 'apsSpent' } } }.
            // so for example path.Beethi.Canexin gives the path and apsSpent
            // going from Beethi to Canexin.
            // Note: we have to calculate both ways, so B -> C and C -> B, 
            // in the case start tiles are different, the apsSpent will vary.
            for ( var i=0; i<beacons.length; i++ ) {
                path[ beacons[i][0] ] = {};
                for (var j=0; j < beacons.length ; j++) {
                    if (j===i || beacons[i][0] == beacons[j][0]) // no need for self to self.
                        continue;
                    path[ beacons[i][0] ][ beacons[j][0] ] = this.planPath( 
                        { // since we plan backwards, our from WH will be our to WH
                            'x': beacons[i][1].x,
                            'y': beacons[i][1].y 
                        }, 
                        {
                            'x': beacons[j][1].x,
                            'y': beacons[j][1].y 

                        },
                        sector );
                    path[ beacons[i][0] ][ beacons[j][0] ].apsSpent += this.TCCWHcost[ beacons[j][1].type ];
                }
            }
            return path;
        }

        function specialTreatment() {
            // Waayan
            copySector.call( this, 'Waayan', 'Waayan (North)' );
            delete this.TCCData[ 'Waayan (North)' ].beacons[ 'HC 4-962 (South)' ];
            renameWH.call( this, 'Waayan (North)', 'HC 4-962 (North)', 'HC 4-962' );
            copySector.call( this, 'Waayan', 'Waayan (South)' )
            delete this.TCCData[ 'Waayan (South)' ].beacons[ 'HC 4-962 (North)' ];
            renameWH.call( this, 'Waayan (South)', 'HC 4-962 (South)', 'HC 4-962' );
            delete this.TCCData[ 'Waayan (South)' ].beacons[ 'JS 2-090' ];
            delete this.TCCData[ 'Waayan' ];
            renameWH.call( this, 'JS 2-090', 'Waayan', 'Waayan (North)' );
            
            // fixing NEX hubs.
            var nexList = [ 'Nex Kataam', 'Nex 0001', 'Nex 0002', 'Nex 0003',
            'Nex 0004', 'Nex 0005', 'Nex 0006' ];
            nexList.forEach( function( element ) {
                for (var i=0; i<nexList.length; i++) {
                    if ( nexList[i] === element )
                        continue;
                    
                    this.TCCData[ element ].beacons[ nexList[i] ] =
                        this.TCCData[ element ].beacons[ 'X-hole' ];
                }
                delete this.TCCData[ element ].beacons[ 'X-hole' ];
            }.bind(this) );
            // fixing Y holes
            var yHoles = [ 'Ras Elased', 'Rigel', 'Cor Caroli' ]
            yHoles.forEach( function( element ) {
                for (var i=0; i<nexList.length; i++) {
                    this.TCCData[ element ].beacons[ nexList[i] ] =
                        this.TCCData[ element ].beacons[ 'Y-hole' ];
                }
                delete this.TCCData[ element ].beacons[ 'Y-hole' ];
            }.bind(this) );
            // Betelgeuse
            copySector.call( this, 'Betelgeuse', 'Betelgeuse (West)' );
            delete this.TCCData[ 'Betelgeuse (West)' ].beacons[ 'Sohoa' ];
            delete this.TCCData[ 'Betelgeuse (West)' ].beacons[ 'Tiacan' ];
            copySector.call( this, 'Betelgeuse', 'Betelgeuse (East)' );
            delete this.TCCData[ 'Betelgeuse (East)' ].beacons[ 'GV 4-652' ];
            delete this.TCCData[ 'Betelgeuse (East)' ].beacons[ 'Rashkan' ];
            delete this.TCCData[ 'Betelgeuse' ];
            // SD
            copySector.call( this, 'SD 3-562', 'SD 3-562 (West)' );
            delete this.TCCData[ 'SD 3-562 (West)' ].beacons[ 'Ross (East)' ];
            renameWH.call( this, 'Pass FED-06', 'SD 3-562', 'SD 3-562 (West)' );      
            copySector.call( this, 'SD 3-562', 'SD 3-562 (East)' );            
            renameWH.call( this, 'SD 3-562 (East)', 'Ross (East)', 'Ross' );
            delete this.TCCData[ 'SD 3-562 (East)' ].beacons[ 'Pass FED-06' ];
            delete this.TCCData[ 'SD 3-562' ];
            // Facece
            copySector.call( this, 'Facece', 'Facece (North)' );
            renameWH.call( this, 'Sodaack', 'Facece', 'Facece (North)' );
            renameWH.call( this, 'Lahola', 'Facece', 'Facece (North)' );
            copySector.call( this, 'Facece', 'Facece (South)' );
            // Heze
            copySector.call( this, 'Heze', 'Heze (North)' );
            renameWH.call( this, 'Heze', 'Nari (North)', 'Nari' );
            delete this.TCCData[ 'Heze (North)' ].beacons[ 'Nari (South)' ];
            delete this.TCCData[ 'Heze (North)' ].beacons[ 'Nunki' ];
            copySector.call( this, 'Heze', 'Heze (South)' );
            delete this.TCCData[ 'Heze (South)' ].beacons[ 'Nari (North)' ];
            delete this.TCCData[ 'Heze (South)' ].beacons[ 'Procyon' ];            
            // Miayda
            // this.TCCData[ 'Miayda (North)' ] = JSON.parse(JSON.stringify( this.TCCData[ 'Miayda' ] ));
            // this.TCCData[ 'Miayda (North)' ].distance = Infinity;
            // this.TCCData[ 'Miayda (North)' ].sector = 'Miayda (North)';
            // this.TCCData[ 'Miayda (South)' ] = JSON.parse(JSON.stringify( this.TCCData[ 'Miayda' ] ));
            // this.TCCData[ 'Miayda (South)' ].distance = Infinity;
            // this.TCCData[ 'Miayda (South)' ].sector = 'Miayda (South)';
            // delete this.TCCData[ 'Miayda' ];
            
            // bewaack
            // this.TCCData[ 'Bewaack (North)' ] = JSON.parse(JSON.stringify( this.TCCData[ 'Bewaack' ] ));
            // this.TCCData[ 'Bewaack (North)' ].distance = Infinity;
            // this.TCCData[ 'Bewaack (North)' ].sector = 'Bewaack (North)';
            // this.TCCData[ 'Bewaack (South)' ] = JSON.parse(JSON.stringify( this.TCCData[ 'Bewaack' ] ));
            // this.TCCData[ 'Bewaack (South)' ].distance = Infinity;
            // this.TCCData[ 'Bewaack (South)' ].sector = 'Bewaack (South)'; 
            // delete this.TCCData[ 'Bewaack' ];
            function copySector( from, to ) {
                this.TCCData[ to ] = JSON.parse(JSON.stringify( this.TCCData[ from ] ));
                this.TCCData[ to ].distance = Infinity;
                this.TCCData[ to ].sector = to;
                }
            function renameWH( sector, from, to ) {
                this.TCCData[ sector ].beacons[ to ] =
                    this.TCCData[ sector ].beacons[ from ];
                delete this.TCCData[ sector ].beacons[ from ];
                }
            }
    }
};
