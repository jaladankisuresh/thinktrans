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
	// un-commited data is not exposed to SELECT queries as it persists within the transactional property of the document 
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
#### 1. Acquire Write Lock: 
If the transaction can acquire write lock, it would lock the document blocking any subsequent transactions concurrently trying to update the document.
#### 2: Update the document
This looks pretty simple. Yes, but this just a happy case

#### What if the lock couldn't be acquired?
#### 1.1 Queue the transaction
Queued transactions get into sleep mode until all the transactions top in the *transient[]* queue before them complete, **OR** until they timeout and fail

#### data transitions for update:

Initial Stage:
```javascript
{
"firstName":  "John" ,
"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
"lastName":  "K" ,
"type":  "User"
}
```

Transient Stage:

*To make it little interesting lets assume we have 2 concurrent transactions trying to update the same John's document*

- trans 1: 66da6196-a955-4a1e-b851-ca49fe01b6c8 - Gets the write lock being the TOP item in the queue.
- trans 2: 045d965d-47a8-4cac-9188-4fc240e25a6f - waitlisted until trans 1 is completed.

Timestamp A
```javascript
{
	"firstName":  "John" ,
	"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
	"lastName":  "K" ,
	"type":  "User",	
	"transactional": {    
		"lock": "close",
		"transient": [
		//trans 1: 66da6196-a955-4a1e-b851-ca49fe01b6c8
		/*
		old_val : mirror of the current state of the document, containing the same values as the 
		COMMITED state of this document. 
		new_val : values SET using the {Table : {set object}}. refer trans.op.update() cmd for a better perspective
		applied_val : TO BE state of the document after the transaction commits
		*/
		{
			"data": {	
				"applied_val" : {
					"firstName":  "John" ,
					"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
					"lastName":  "Kennedy" ,
					"type":  "User"
				},
				"new_val": {"lastName":  "Kennedy"},
				"old_val": {
					"firstName":  "John" ,
					"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
					"lastName":  "K" ,
					"type":  "User"
				}
			},
			"state": "applied",
			"type": "replace",
			"created":  "2016-11-23T09:52:26.645Z",
			"transactionId" :"66da6196-a955-4a1e-b851-ca49fe01b6c8"
		},
		//trans 2: 045d965d-47a8-4cac-9188-4fc240e25a6f 
		/*
		old_val : undefined; TO BE UPDATED after acquiring lock
		new_val : values SET using the {Table : {set object}}. refer trans.op.update() cmd for a better perspective
		applied_val : undefined; TO BE UPDATED after acquiring lock
		*/
		{
			"data": {				
				"new_val": {"firstName":  "John F"}
			},
			"state": "pending",
			"type": "replace",
			"created":  "2016-11-23T09:52:27.645Z",
			"transactionId" :"045d965d-47a8-4cac-9188-4fc240e25a6f"
		}
		]
	}
}
```

Timestamp B, After *trans 1: 66da6196-a955-4a1e-b851-ca49fe01b6c8* has completed successfully
```javascript
{
	"firstName":  "John" ,
	"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
	"lastName":  "Kennedy" ,
	"type":  "User",	
	"transactional": {    
		"lock": "close",
		"transient": [
		//trans 2: 045d965d-47a8-4cac-9188-4fc240e25a6f 
		/*
		old_val : mirror of the current state of the document, containing the same values as the 
		COMMITED state of this document. 
		new_val : values SET using the {Table : {set object}}. refer trans.op.update() cmd for a better perspective
		applied_val : TO BE state of the document after the transaction commits
		*/
		{
			"data": {	
				"applied_val" : {
					"firstName":  "John F" ,
					"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
					"lastName":  "Kennedy" ,
					"type":  "User"
				},
				"new_val": {"firstName":  "John F"},
				"old_val": {
					"firstName":  "John" ,
					"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
					"lastName":  "Kennedy" ,
					"type":  "User"
				}
			},
			"state": "applied",
			"type": "replace",
			"created":  "2016-11-23T09:52:27.645Z",
			"transactionId" :"045d965d-47a8-4cac-9188-4fc240e25a6f"
		}
		]
	}
}
```

Commit Stage

```javascript
{
"firstName":  "John F" ,
"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
"lastName":  "Kennedy" ,
"type":  "User"
}
```

## Delete
Process is similar to Update
#### 1. Acquire Write Lock: 
If the transaction can acquire write lock, it would lock the document blocking any subsequent transactions concurrently trying to update/delete the document.
#### 2: Update the document
This looks pretty simple. Yes, but this just a happy case

#### What if the lock couldn't be acquired?
#### 1.1 Queue the transaction
Queued transactions get into sleep mode until all the transactions top in the *transient[]* queue before them complete, **OR** until they timeout and fail

#### data transitions for delete:

Initial Stage:
```javascript
{
"firstName":  "John F" ,
"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
"lastName":  "Kennedy" ,
"type":  "User"
}
```

Transient Stage
```javascript
{
	"firstName":  "John F" ,
	"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
	"lastName":  "Kennedy" ,
	"type":  "User",
	"transactional": {    
		"lock": "close",
		"transient": [
		/*
		old_val : mirror of the current state of the document, containing the same values as the 
		COMMITED state of this document. 
		new_val : null
		*/
		{
			"data": {			
			"old_val": {
				"firstName":  "John F" ,
				"id":  "5f4e1f64-d1c0-4b3d-b32d-97c96821d1ed" ,
				"lastName":  "Kennedy" ,
				"type":  "User"
			},
			"new_val": null
			},
			"state": "applied",
			"type": "delete",
			"created":  "2016-11-23T09:52:26.645Z",
			"transactionId" :"d49076b2-3423-4d15-af50-6ceb8a53ceab"
		}
		]
	}
}
```
