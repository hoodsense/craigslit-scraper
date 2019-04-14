const cheerio = require('cheerio');
const axios = require('axios');
const mongoose = require('mongoose');
const {Schema} = mongoose;
const {URL} = require('url');
const _ = require('lodash')

mongoose.connect('mongodb://localhost/hoodsense-craigslist', {useNewUrlParser: true});

const model = new Schema({
    address: String,
    location: {
        lat: Number,
        lng: Number
    },
    rent: Number,
    scrapeDate: Date,
    bedrooms: Number,
    description: String,
    isAirBnB: Boolean,
    size: String,
    amenity: {
        laundry: Boolean,
        hydro: Boolean,
        gas: Boolean,
        parking: Boolean,
        dishwasher: Boolean        
    }
});

const Apartment = mongoose.model('Apartment',model);

// Process
// Get all the URL's for the single pages
    // Keep requesting the next page until "no results" shows up.
// Get all of those pages and build the model from there.
    // Then loop through and get each 

const pageSize = 120;

// Get the next page of listings
function getListingPage(page) {
    return () => axios.get(`https://toronto.craigslist.org/search/apa?s=${page * pageSize}`);
}

// Get the single page listing
function getSingleListingPage(url) {
    return () => axios.get(url);
}
    
async function getData() {
    const links = [];
    const linkRequests = [];
    console.log('Getting pages');
    for(let i = 0; i < 24; i++) {
        console.log(`Getting page ${i}`);
        linkRequests.push(getListingPage(i));
    }
    
    const callsPromises = linkRequests.map((fn) => fn());
    
    const pageResults = await Promise.all(callsPromises)
    // We now have an array of the 5 pages.
    // For each page we need to get all the .row-results
    // and then the first a tag href inside;
    console.log('Got all pages');
    pageResults
        .map(({data}) => data)
        .forEach((html) => {
            const $ = cheerio.load(html);
            const rowResults = $('.result-row a.result-image');
            rowResults.each((i,el) => {
                if(el) {
                    links.push(el.attribs.href);
                }
            });
        });

    console.log('Getting listings pages');
    const singleListingRequests = links.map(getSingleListingPage);
    const chunkedListingCall = _.chunk(singleListingRequests,10);
    console.log(`Getting ${singleListingRequests.length} listing pages`);
    /*     
    [[() => P1,() => P2],[() => P3,() => P4]] 
    */
    let count = 0; 
    chunkedListingCall.reduce((p,curr) => {
        return p.then(() => {
            return new Promise(async (res) => {
                const listingCall = curr.map(fn => fn());
                const listingResults = await Promise.all(listingCall);
                console.log(`Gathering data for ${count += listingCall.length} of ${singleListingRequests.length}`);
                listingResults
                    .map(({ data }) => data)
                    .forEach(html => {
                        const $ = cheerio.load(html);
                        const addressElement = $('p.mapaddress a')[0]
                        const addressURL = addressElement ? new URL(addressElement.attribs.href) : null;
                        const addressQuery = addressURL ? addressURL.searchParams.get('q') : null;
                        const address = addressQuery ? addressQuery.replace('loc: ', '') : '';
                        const apartment = {
                            rent: $('.price').text().replace('$', ''),
                            description: $('#postingbody').text(),
                            address,
                            scrapeDate: Date.now(),
                            location: {
                                lat: $('#map').data('latitude'),
                                lng: $('#map').data('longitude')
                            },
                            isAirBnB: false,

                        };
                        const apt = new Apartment(apartment);
                        apt.save();
                    });
                res();
            });
        });
    }, Promise.resolve())
    
    console.log('Done');
}

getData();