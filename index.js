const http = require('axios')
const express = require('express')
const mongoose = require('mongoose')
const config = require('config')
const Schema = mongoose.Schema
const app = express()

const ExchangeSchema = new Schema({
    success: { type: Boolean, required: false },
    timestamp: {type: Date, required: true },
    historical: { type: Boolean, required: true },
    base: {type: String, required: true },
    rates: { type: Object, required: true },
    rates: { type: Schema.Types.Mixed, required: true } 
})

const validDateRegex = /(\d{4})-(\d{2})-(\d{2})/
const PORT = process.env.PORT || 3000
const ExchangeModel = mongoose.model('cached-responses', ExchangeSchema)
const mongoDB = process.env.MONGODB_URI || config.get('mongodbUri')
const fixerAccessKey = process.env.FIXER_ACCESS_KEY || config.get('fixerAccessKey')

mongoose.connect(mongoDB)
mongoose.Promise = global.Promise
let db = mongoose.connection
db.on('error', console.error.bind(console, 'MongoDB connection error:'))

const getCurrentDate = () => {
    let date = new Date()
    date.setUTCHours(0, 0, 0, 0)
    return date
}

const callDb = (route) => new Promise((resolve, reject) => {
    let routeDate = new Date(route);
    let dateRangeStart = route === "latest" ? getCurrentDate() : new Date(Date.UTC(routeDate.getFullYear(), routeDate.getMonth(), routeDate.getDate(), 0,0,0,0));
    let dateRangeEnd = new Date(dateRangeStart.getTime());
    dateRangeEnd.setUTCDate(dateRangeStart.getUTCDate() + 1)

    ExchangeModel.findOne({ timestamp: { "$gte": dateRangeStart, "$lt": dateRangeEnd } }).exec(function (err, rates) {
        if (err) {
            reject("Whoops! Something didn't go as planned")
        } else if (!rates) {
            resolve(null)
        } else {
            resolve(rates)
        }
    })
})

const callSource = (route) => new Promise((resolve, reject) => {
    http.get(`http://data.fixer.io/api/${route}?access_key=${fixerAccessKey}`)
        .then(response => {
            if(response.data.success !== true){
                reject("Invalid request")
            }
            response.data.timestamp = new Date(response.data.timestamp * 1000)
            if (response.data.historical !== true) {
                response.data.historical = false
            }

            let rates = new ExchangeModel(response.data)
            ExchangeModel.insertMany([rates])

            resolve(rates)
        }, error => reject(error))
})

const getCacheElseSource  = async (route) => {
    let data = await callDb(route)
    if(data) return data
    return await callSource(route)
}

const respond = (responseData, res)=> {
    res.set("Content-Type", "application/json")
    res.send(responseData)
    return;
}

app.get('/latest', (req, res) => getCacheElseSource("latest")
    .then(response => respond(response, res), err => res.status(503).send(err))
)
app.get(validDateRegex, (req, res) => getCacheElseSource(req.path.trim(req.path.slice(1)))
    .then(response => respond(response, res))
    .catch(err => {
        res.status(503).send(err)
        console.log(err)
    })
)


// We know they are sending a date but it's not the format we want
app.get(/^\/\d{4}\-\d{1,2}\-\d{1,2}$/, (req, res) => res.status(400).send("Invalid date format, please use YYYY-MM-DD"))
app.get(/^\/\d{4}[\/.]\d{1,2}[\/.]\d{1,2}$/, (req, res) => res.status(400).send("Invalid date format, please use YYYY-MM-DD"))

app.use(express.static('.well-known'))

// 
app.get('*', (req, res) => res.status(404).send("Page not found"))

app.listen(PORT, () => console.log(`Example app listening on port ${PORT}!`))