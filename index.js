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

const action = args[2]
const dir = args[3]
const domain = dir.split('/')[0]

if (action !== 'upload' && action !== 'download') return console.error(`Invalid parameter '${action}' should be 'upload' or 'download'`)

const project = _.get(manifest, 'projects.' + domain)
if (!project) return console.error(`Project '${domain}' does not exist in the manifest`)
const nodriza = new Nodriza(project.nodrizaCredetials)

action === 'upload' ? upload() : download()

function download () {
	let dirs = dir.split('/')
	let filePath = (dirs.length == 1) ? domain + '/' : dir
	list(filePath, (err, files) => {
		if (err) return console.error('Listing error:', err)
		downloadRecursive(files, (err, res) => {
			if (err) return console.error('Download Error:', err)
			console.log('> Download Completed!'.green)
		})
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

function downloadRecursive (fileList, callback) {
	if (_.isEmpty(fileList)) return callback()
	let dirs = []
	let files = []
	for (let i = 0; i < fileList.length; i++) {
		let file = fileList[i]
		file.isDir ? dirs.push(file) : files.push(file)
	}
	// return console.log('->>> dirs:', dirs)
	async.timesLimit(files.length, 3, (i, callback) => {
		let file = files[i]
		let filePath = './accounts/' + file.key
		let index = filePath.lastIndexOf("/")
		let path = filePath.slice(0, index)
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
				list(file.key, (err, files) => {
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

function list (key, callback) {
	nodriza.api.fileData.list({key}, (err, data) => {
		err ? callback(err) : callback(null, data)
	})	
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