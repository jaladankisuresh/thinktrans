# Implementing Transactions in No SQL Databases - Algorithm

### Definitions

#### Write Lock : 
Every transaction needs to acquire a write lock at a document level before we could it write its changes to the document

#### Transaction Queue:
Every transaction manipulating the document lives in the transaction queue, either in PENDING state waiting for the lock 
or in APPLIED state if it posses the lock and is top of the transation queue.

> **thinktrans** is a declarative javascript library supporting INSERT, UPDATE and DELETE operations. And, it is makes some opinions on 
the structure of your data sets passed to it, like expecting **id** (primary key).

## Insert
#### Validate if duplicate: 
If your NoSQL DB supports creating Unique Compound indexes, you are partly at luck, but not full yet if you also want to validate 
for duplicates against UNCOMMITED transactional data (transactions that have inserted data, but the transactions themselves have not been commited). 
You may better understand this with an example, read on

**thinktrans** tries to compare every property of the INSERTING document with corresponding properties of existing documents, 
EXCEPT for **id** (PRIMARY KEY) and **date** (Could be a created date property of the document) 

```javascript

let uniqueFilter = JSON.parse(JSON.stringify(params.args));
delete uniqueFilter.id;
delete uniqueFilter.date;

//1. Check against COMMITED data
r.table(params.table).filter(uniqueFilter)

//2. Check against UNCOMMITED data
return r.table(params.table).filter({transactional : {lock : 'close'}}).map(
  r.branch(
  r.row('transactional')('transient')(0)('type').eq('replace'),
      r.row('transactional')('transient')(0)('data')('applied_val'),
  r.row('transactional')('transient')(0)('type').eq('add'),
      r.row('transactional')('transient')(0)('data')('new_val'),
  null
  )
).filter(uniqueFilter)
```
#### data transitions for insert:

Transient Stage
```javascript
{
	"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
	"transactional": {    
		"lock": "close",
		"transient": [{
			"data": {			
				"new_val": {
					"firstName":  "John" ,
					"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
					"lastName":  "K" ,
					"type":  "User"
				},
			"old_val": null
			},
			"state": "applied",
			"type": "add",
			"created":  "2016-11-23T09:52:26.645Z",
			"transactionId" :"d49076b2-3423-4d15-af50-6ceb8a53ceab"
		}]
	}
}
```

Commited Stage
```javascript
{
"firstName":  "John" ,
"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
"lastName":  "K" ,
"type":  "User"
}
```

## Update

## Delete

