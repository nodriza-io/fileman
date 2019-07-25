const Nodriza = require('nodriza')
const _ = require('lodash')
const colors = require('colors')
const numeral = require('numeral')
const async = require('async')
const request = require('request')
const moment = require('moment')
const prompt = require('prompt')
const manifest = require('./manifest.json')
const project = manifest.projects[manifest.defaultProject]
const nodriza = new Nodriza(project.nodrizaCredetials)

function authNodiza (callback) {
	console.log(`Authenticating Nodriza account...`.blue)
	nodriza.api.user.me((err, profile) => {
		if (err) return callback(err)
		console.log(`Welcome ${profile.firstName}, ${project.nodrizaCredetials.hostname} API credetials OK!`.blue)
		console.log('------------------------------------------'.blue)
		if (callback) callback()
	})
}