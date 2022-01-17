const test = require('tape')
const rfc = require('./')

test('simple', (t) => {
const search = rfc.search('punycode')

  search.on('result', (result) => {
    if (result.isSynced()) {
      t.ok()
      result.open()
        .on('open', (pager) => {
          t.ok()
          pager.close()
        })
        .on('close', () => t.end())
        .on('error', (err) => {
          throw err
        })
    } else {

      result.sync()
        .on('error', (err) => {
          console.error('error: %s', err)
        })
        .on('end', () => {
          t.ok()
          result.open()
            .on('open', (pager) => pager.close())
            .on('close', () => t.end())
        })
    }
  })
})
