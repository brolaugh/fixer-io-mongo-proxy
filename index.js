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
    let date = new Date(new Date().getTime())
    date.setUTCHours(0, 0, 0, 0)
    return date
}

const callDb = (route) => new Promise((resolve, reject) => {
    route = route.split('/')[1]

    let dateRangeStart = route === "latest" ? getCurrentDate() : new Date(Date.UTC(route.split("-")[0], route.split("-")[1]-1, route.split("-")[2]))
    let dateRangeEnd = new Date(dateRangeStart.getTime())
    dateRangeEnd.setUTCDate(dateRangeStart.getUTCDate() + 1)

    ExchangeModel.findOne({ timestamp: { "$gte": dateRangeStart, "$lt": dateRangeEnd } }).exec(function (err, rates) {
        if (err) {
            reject(err)
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
                return;
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

const getExchangeRateRange = (start_date, end_date, exchangeRates) => new Promise((resolve, reject) => {
    const dateRangeStart = new Date(Date.UTC(start_date.split("-")[0], start_date.split("-")[1] - 1, start_date.split("-")[2]))
    const dateRangeEnd = new Date(Date.UTC(end_date.split("-")[0], end_date.split("-")[1] - 1, end_date.split("-")[2]))
    dateRangeEnd.setUTCDate(dateRangeEnd.getDate() + 1)

    const base = "EUR"
    let projection = {
        _id: 1,
        timestamp: 1,
    }
    
    let query = null;

    if(exchangeRates && exchangeRates.length > 0){
        exchangeRates.forEach(element => projection[`rates.${element}`] = 1)
    }else{
        projection.rates = 1
    }

    ExchangeModel.aggregate([
        { $match: { timestamp: { "$gte": dateRangeStart, "$lte": dateRangeEnd }, base: base } },
        { $project: projection },
        { $sort: { timestamp: 1 } }
    ]).exec((err, mongoRates) => {

        if(err){
            reject(err)
            return
        }
        if (!mongoRates){
            resolve(null)
        }else{
            let instance = {
                success: true,
                start_date: dateRangeStart,
                end_date: dateRangeEnd,
                base: base,
                rates: {}
            }
            mongoRates.forEach(element => {
                instance.rates[element.timestamp.toISOString().split("T")[0]] = element.rates
            })
            resolve(instance)
        }
        
    })
})


const respond = (responseData, res)=> {
    res.set("Content-Type", "application/json")
    res.send(responseData)
    return;
}

app.get('/latest', (req, res) => getCacheElseSource("/latest")
    .then(response => respond(response, res))
    .catch(err => {
        res.status(503).send(err)
        //console.log(err)
    })
)
app.get(validDateRegex, (req, res) => getCacheElseSource(req.path.trim(req.path))
    .then(response => respond(response, res))
    .catch(err => {
        res.status(503).send(err)
        console.log(err)
    })
)
app.get("/timeseries", (req, res) => {
    const symbols = req.query.symbols ? req.query.symbols.split(',') : []
    return getExchangeRateRange(req.query.start_date, req.query.end_date, symbols)
        .then(response => respond(response, res))
        .catch(err => {
            res.status(503).send(err)
            //console.log(err)
        })
    })
    

// We know they are sending a date but it's not the format we want
app.get(/^\/\d{4}\-\d{1,2}\-\d{1,2}$/, (req, res) => res.status(400).send("Invalid date format, please use YYYY-MM-DD"))
app.get(/^\/\d{4}[\/.]\d{1,2}[\/.]\d{1,2}$/, (req, res) => res.status(400).send("Invalid date format, please use YYYY-MM-DD"))

app.use(express.static('.well-known'))

// 
app.get('*', (req, res) => res.status(404).send("Page not found"))

app.listen(PORT, () => console.log(`Example app listening on port ${PORT}!`))