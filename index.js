const Nodriza = require('nodriza')
const _ = require('lodash')
const colors = require('colors')
const numeral = require('numeral')
const async = require('async')
const request = require('request')
const moment = require('moment')
const prompt = require('prompt')
const manifest = require('./manifest.json')
const fs = require('fs')
const progress = require('request-progress')
const args = process.argv
const recursive = require("recursive-readdir")
const chokidar = require('chokidar')
let queue = []

if (args.length < 4) {
	return console.error(`

	Error: Insufficient arguments

	> Example Upload:
	e.g npm run upload account-name
	e.g npm run upload "account-name/path to sync/"

	> Example Download:
	e.g npm run download account-name
	e.g npm run download "account-name/path to sync/"

`.red)
}

printLogo()

const action = args[2]
const dir = args[3]
const domain = dir.split('/')[0]

if (action !== 'upload' && action !== 'download') return console.error(`Invalid parameter '${action}' should be 'upload' or 'download'`)

const project = _.get(manifest, 'projects.' + domain)
if (!project) return console.error(`Project '${domain}' does not exist in the manifest`)
const nodriza = new Nodriza(project.nodrizaCredetials)
const ignore = project.ignore || []
const authorization = 'bearer ' + project.nodrizaCredetials.accessToken
const uploadEndpoint = 'https://' + domain + '.nodriza.io/v1/fileData/upload'

action === 'upload' ? upload() : download()

function upload () {
	const root = 'accounts/' + domain
	if (!fs.existsSync(root)) fs.mkdirSync(root)
	watch()
}

function _upload () {
	let dirs = dir.split('/')
	let filePath = (dirs.length == 1) ? domain + '/' : dir
	localList(filePath, (err, files) => {
		if (err) return console.error('Listing error:', err)
		console.log(`\n> Starting sync process,\n  ${files.length} files in queue...\n`.magenta)
		uploadRecursive(files, (err, res) => {
			if (err) return console.error('Upload Error:', err)
			console.log(`\n> Nodriza '${domain}' account sync done! \n  ${files.length} Files sync successfully.\n`.magenta)
		})
	})
}

function localList (filePath, callback) {
	recursive('accounts/' + filePath, (err, files) => {
		if (err) return callback(err)
		callback(null, files)
	})	
}

function uploadRecursive (files, callback) {
	let count = 0
	async.timesLimit(files.length, 1, (i, callback) => {
		let key = files[i].slice(9)
		let remoteKey = renameKey(key)
		count++
		console.log(`> Sync ${count} of ${files.length} - ${((count * 100) / files.length).toFixed(2)}%\n       from ${key} \n       to https://s3.amazonaws.com/files.nodriza.io/${remoteKey}`)
		let localFile
		let remoteFile
		const tasks = {
			checkIfExist: (callback) => {
				nodriza.api.fileData.find({key: remoteKey}, (err, _file) => {
					if (err) return callback(err)
					if (_.isEmpty(_file)) return callback()
					remoteFile = _file[0]
					callback()
				})
			},
			checkSize: (callback) => {
				fs.stat('accounts/' + key, (err, stat) => {
					if (err) return callback()
					localFile = stat
					callback()
				})				
			},
			upload: (callback) => {
				if (remoteFile && remoteFile.size === localFile.size) return callback()
				let opt = {
					method: 'POST',
				  url: uploadEndpoint,
				  headers: {
				    authorization,
				    'content-type': 'multipart/form-data;',
				    accept: 'application/json, text/plain, */*',
				    'accept-encoding': 'gzip, deflate'
				  },
				  formData: {
				    key: remoteKey.slice(domain.length + 1),
						size: localFile.size,
				    file: {
				      value: fs.createReadStream('accounts/' + key),
				      options: {
				        filename: remoteKey,
				        contentLength: localFile.size
				      }
				    }
				  }
				}
				uploadFile(opt, (err, res) => {
					err ? callback(err) : callback()
				})
			}
		}
		async.series(tasks, (err) => {
			err ? callback(err) : callback()
		})
	}, (err) => {
		err ? callback(err) : callback()
	})
}

function uploadFile (opt, callback) {
	let dirExist
	let dir = opt.formData.key.split('/')
	let path = getPath(opt.formData.key)
	const tasks = {
		validateDirExist: (callback) => {
			remoteList(domain + '/' + path, (err, exist) => {
				dirExist = exist ? true : false
				callback()
			})
		},
		createDirsRecursive: (callback) => {
			if (dirExist) return callback()
			createDirRecursive(opt.formData.key, (err, res) => {
				err ? callback(err) : callback()
			})
		},
		uploadFile: (callback) => {
			console.log(`...uploading ${opt.formData.key} - Size: ${numeral(opt.formData.size).format('0.00 b')}`)
			request(opt, (error, res, body) => {
				if (error) return callback(error)
				let json
				try {
					json = JSON.parse(body)
				} catch(e) {
					return callback(e)
				}
				let errMsg = _.get(json, 'error')
				if (res.statusCode !== 200) return callback(errMsg)
				console.log(`> Upload done: ${json.location}`.green)
				callback()
			})
		}		
	}
	async.series(tasks, (err) => {
		err ? callback(err) : callback()
	})
}

function createDirRecursive (dir, callback) {
	let dirs = dir.split('/')
	dirs.pop()
	let paths = []
	let str = ''
	for (let i = 0; i < dirs.length; i++) {
		let dir = dirs[i]
		str += dir + '/'
		paths.push(str)
	}
	async.timesLimit(paths.length, 1, (i, callback) => {
		let path = paths[i]
		createDir(path, callback)
	}, (err) => {
		err ? callback(err) : callback()
	})
}

function createDir (key, callback) {
	let opt = {
		method: 'POST',
	  url: uploadEndpoint,
	  headers: {
	    authorization,
	    accept: 'application/json, text/plain, */*',
	  },
	  json: true,
	  body: {key, size: 0}
	}
	let dirExist
	const tasks = {
		validateDirExist: (callback) => {
			let path = domain + '/' + key
			remoteList(path, (err, exist) => {
				dirExist = exist ? true : false
				callback()
			})
		},
		createDir: (callback) => {
			if (dirExist) return callback()
			request(opt, (error, res, body) => {
				if (error) return callback(error)
				if (res.statusCode !== 200) return callback(body)
				console.log(`>'${key}' directory has been created!`)
				callback()
			})
		}		
	}
	async.series(tasks, (err) => {
		err ? callback(err) : callback()
	})
}

function dirNotExist (errMsg) {
	return errMsg.indexOf('Please create the parent forlder first') !== -1	? true : false
}

function download () {
	let dirs = dir.split('/')
	let filePath = (dirs.length == 1) ? domain + '/' : dir
	remoteList(filePath, (err, files) => {
		if (err) return console.error('Listing error:', err)
		downloadRecursive(files, (err, res) => {
			if (err) return console.error('Download Error:', err)
			console.log('> Download Completed!'.green)
		})
	})
}

function remoteList (key, callback) {
	nodriza.api.fileData.list({key}, (err, data) => {
		err ? callback(err) : callback(null, data)
	})
}

function writeFile (params, callback) {
	const url = params.url
	const filePath = params.filePath
	if (!_.isString(url)) return callback('Invalid required key \'url\' in params')
	if (!_.isString(filePath)) return callback('Invalid required key \'filePath\' in params')
	let download
	let exist
	let size
	let contentLength
	const tasks = {
		checkFileSize: (callback) => {
			fs.stat(filePath, (err, stat) => {
				if (err) return callback()
				exist = true
				size = stat.size
				callback()
			})
		},
		compare: (callback) => {
			if (!exist) return callback()
			request.head(url, (err, res, body) => {
				if (err) return callback()
				try {
					contentLength = parseInt(res.toJSON().headers['content-length'])
				} catch(e) {
					return callback(e)
				}
				callback()
			})
		},
		download: (callback) => {
			if (exist && size === contentLength) {
				console.log(`> Exist ${url}`.green)
				return callback()
			} else {
				console.log(`> Downloading ${url}`.blue)
			}
			progress(request(url), {}).on('progress',  (state) => {
				// console.log(`> ${url} > ${state.percent}% - Remaining ${state.time.remaining} Sec`)
			}).on('error',  (err) => {
				callback(err)
			}).on('end', () => {
				console.log(`> done ${url}`.green)
				callback()
			}).pipe(fs.createWriteStream(filePath))
		}		
	}
	async.series(tasks, (err) => {
		err ? callback(err) : callback()
	})
}

function getPath (key) {
	let index = key.lastIndexOf("/")
	return key.slice(0, index + 1)
}

function downloadRecursive (fileList, callback) {
	if (_.isEmpty(fileList)) return callback()
	let dirs = []
	let files = []
	for (let i = 0; i < fileList.length; i++) {
		let file = fileList[i]
		file.isDir ? dirs.push(file) : files.push(file)
	}
	async.timesLimit(files.length, 3, (i, callback) => {
		let file = files[i]
		let filePath = './accounts/' + file.key
		let path = getPath(filePath)
		fs.mkdir(path, {recursive: true}, (err) => {
			if (err) return callback(err)
			let obj = {url: file.location, filePath}
			writeFile(obj, (err, res) => {
				err ? callback(err) : callback()
			})
		})
	}, (err) => {
		if (err) return callback(err)
		if (_.isEmpty(dirs)) return callback()
		async.timesLimit(dirs.length, 10, (i, callback) => {
			let file = dirs[i]
			fs.mkdir('./accounts/' + file.key, {recursive: true}, (err) => {
				if (err) return callback(err)			
				remoteList(file.key, (err, files) => {
					if (err) return callback(err)
					downloadRecursive(files, (err, res) => {
						err ? callback(err) : callback()
					})
				})
			})
		}, (err) => {
			err ? callback(err) : callback()
		})
	})
}

function watch () {

	console.log('> Watching for changes...'.blue)

	setInterval(() => {
		if (!_.isEmpty(queue)) {
			console.log(`\n> Starting sync process,\n  ${queue.length} files in queue...\n`.magenta)
			let _queue = _.cloneDeep(queue)
			uploadRecursive(_queue, (err, res) => {
				if (err) return console.error('Upload Error:', err)
				console.log(`\n> Nodriza '${domain}' account sync done! \n  ${_queue.length} Files sync successfully.\n`.magenta)			
			})
			queue = []
		}
	}, 3000)

	const watcher = chokidar.watch(`accounts/${domain}/`, {ignored: /^\./, persistent: true})
	watcher.on('add', (file) => {
		addFile(file)
		// console.log('File', file, 'has been added')
	}).on('change', (file) => {
		if (addFile(file)) console.log(`> ${file} has changed...`.magenta)
  }).on('unlink', (file) => {
  	// console.log('File', file, 'has been removed')
  }).on('error', (error) => {
  	// console.error('Error happened', error)
  })
}

function addFile (file) {
	let add = true
	var fileExtensionPattern = /\.([0-9a-z]+)(?=[?#])|(\.)(?:[\w]+)$/gmi
	for (let i = 0; i < ignore.length; i++) {
		let str = ignore[i]
		let ext = file.match(fileExtensionPattern)[0]
		if (ext === str) {
			add = false
			break
		}
	}
	if (add) queue.push(file)
	return add
}
function renameKey (key) {
  let arr = key.split('/')
  for (let i = 0; i < arr.length; i++) {
    arr[i] = arr[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    arr[i] = arr[i].replace(/(?!\.[^.]+$)\.|[^\w.]+/g, '-')
  }
  return arr.join('/')
}

function authNodiza (callback) {
	console.log(`Authenticating Nodriza account...`.blue)
	nodriza.api.user.me((err, profile) => {
		if (err) return callback(err)
		console.log(`Welcome ${profile.firstName}, ${project.nodrizaCredetials.hostname} API credetials OK!`.blue)
		console.log('------------------------------------------'.blue)
		if (callback) callback()
	})
}

function printLogo (callback) {
  console.log('\n> Starting Nodriza File Manager Framework...'.blue)
  console.log('')
  console.log('')
  console.log('       .:/++++/:-`     '.blue + '        :o: '.yellow + '       `/.        '.red)
  console.log('     -++:-````.:++:`   '.blue + '       -hh: '.yellow + '      `///.       '.red)
  console.log('    /+/`        `:++`  '.blue + '      .hd/  '.yellow + '     `//.//.      '.red)
  console.log('   .++`           ++:  '.blue + '     `yd+   '.yellow + '    `//. `//.     '.red)
  console.log('   -++            /+/  '.blue + '    `ydo    '.yellow + '   `//.   `//.    '.red)
  console.log('   `++-          .++-  '.blue + '   `sds     '.yellow + '  `//.     `//.   '.red)
  console.log('    .++:`      `-++-   '.blue + '   ody`     '.yellow + ' `//-       .//.  '.red)
  console.log('     `:++/::::/++:`    '.blue + '  /dy`      '.yellow + '`:/-         .//. '.red)
  console.log('        `.----.`       '.blue + '   ``       '.yellow + '`..           `...'.red)
  console.log('                                                     ')
  console.log('')
}