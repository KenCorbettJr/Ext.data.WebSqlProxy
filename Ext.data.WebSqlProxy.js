/**
 * @author Grgur Grisogono. Modifications for Sencha Touch by Lisimba Gilkes (lisimba.gilkes@lisimba.co.uk)
 *
 * WebSQL proxy connects models and stores to local WebSQL database.
 *
 * WebSQL is only available in Chrome and Safari at the moment.
 * 
 * Version: 0.2
 *
 * TODO: respect sorters, filters, start and limit options on the Operation; failover option for remote proxies, ..
 */
// Ext.data.WebSqlProxy = Ext.extend(Ext.data.Proxy, {
Ext.define('Ext.data.proxy.WebSql', {
    extend: 'Ext.data.proxy.Proxy',
    alias: 'proxy.websql',
    config: {
        /**
         * @cfg {String} version
         * database version. If different than current, use updatedb event to update database
         */
        dbVersion: '1.0',

        /**
         * @cfg {String} dbName
         * Name of database
         */
        dbName: undefined,

        /**
         * @cfg {String} dbDescription
         * Description of the database
         */
        dbDescription: '',

        /**
         * @cfg {String} dbSize
         * Max storage size in bytes
         */
        dbSize: 10 * 1024 * 1024,

        /**
         * @cfg {String} dbTable
         * Name for table where all the data will be stored
         */
        dbTable: undefined,

        /**
         * @cfg {String} pkField
         * Primary key name. Defaults to idProperty
         */
        pkField: undefined,

        /**
         * @cfg {String} pkType
         * Type of primary key. By default it an autoincrementing integer
         */
        pkType: 'TEXT PRIMARY KEY ASC',

        /**
         * @cfg {Array} initialData
         * Initial data that will be inserted in object store on store creation
         */
        initialData: []
    },


    /**
     * @private
     * db object
     */
    db: undefined,

    /**
     * @private
     * used to monitor initial data insertion. A helper to know when all data is in. Helps fight asynchronous nature of idb. 
     */
    initialDataCount: 0,

    /**
     * @private
     * Trigger that tells that proxy is currently inserting initial data
     */
    insertingInitialData: false,

    /**
     * Creates the proxy, throws an error if local storage is not supported in the current browser.
     * @param {Object} config (optional) Config object.
     */
    constructor: function (config) {
        this.registerExtJsFx();
        // Ext.apply(this, config || {
        // });
        
        // Ext.data.proxy.WebSql.superclass.constructor.call(this, config);
        this.initConfig(config);
        
        this.checkDependencies();

        this.addEvents('dbopen', 'updatedb', 'exception', 'cleardb', 'initialDataInserted', 'noWebDb');
        this.callParent(arguments);
        // this.initialize();
    },

    /**
     * @private
     * Sets up the Proxy by opening database and creating table if necessary
     */
    initialize: function () {
        var me = this,
            pk = 'id',
            db;

        me.db = db = openDatabase(me.getDbName(), me.getDbVersion(), me.getDbDescription(), me.getDbSize());

        //take care of the table
        db.transaction(function (tx) {
            pk = me.getPkField() || me.getReader().idProperty || pk;
            me.setPkField(pk);
            var createTable = function () {
                    tx.executeSql('CREATE TABLE IF NOT EXISTS ' + me.getDbTable() + '(' + pk + ' ' + me.getPkType() + ', ' + me.constructFields() + ')', [], Ext.bind(me.addInitialData, me), //on success
                    Ext.bind(me.onError, me)); // on error
                }
            tx.executeSql('SELECT * FROM ' + me.getDbTable() + ' LIMIT 1', [], Ext.emptyFn, createTable);

        });
    },

    /**
     * @private
     * Get reader data and set up fields accordingly
     * Used for table creation only
     * @return {String} fields separated by a comma
     */
    constructFields: function () {
        var me = this,
            m = me.getModel(),
            fields = m.prototype.fields.items,
            flatFields = [];

        Ext.each(fields, function (f) {
            var name = f.getName();
            if (name == me.getPkField()) {
                return;
            }
            var type = f.getType().type;

            type = type.replace(/int/i, 'INTEGER').replace(/string/i, 'TEXT').replace(/date/i, 'DATETIME');

            flatFields.push('"' + name + '" ' + type);
        });

        return flatFields.join(',');
    },

    /**
     * Universal error reporter for debugging purposes
     * @param {Object} err Error object.
     */
    onError: function (err, e) {

        var error = (e && e.message) || err;
        console.log(error, arguments);

    },

    /**
     * Check if all needed config options are set
     */
    checkDependencies: function () {

        var me = this;

        if (!window.openDatabase) {
            me.fireEvent('noWebDb');
            Ext.Error.raise("WebDB is not supported in your browser.");
        }

        if (!Ext.isString(me.getDbName())) console.log("The dbName string has not been defined in your Ext.data.proxy.WebDB");
        if (!Ext.isString(me.getDbTable())) console.log("The dbTable string has not been defined in your Ext.data.proxy.WebDB");

        return true;
    },

    /**
     * Add initial data if set at {@link #initialData}
     */
    addInitialData: function () {
        this.addData();
    },

    /**
     * Add data when needed
     * Also add initial data if set at {@link #initialData}
     * @param {Array/Ext.data.Store} newData Data to add as array of objects or a store instance. Optional
     * @param {Boolean} clearFirst Clear existing data first
     */
    addData: function (newData, clearFirst) {

        var me = this,
            model = me.getModel().modelName,
            data = newData || me.getInitialData();
        //clear objectStore first
        if (clearFirst === true) {
            me.clear();
            me.addData(data);
            return;
        }

        if (Ext.isObject(data) && data.isStore === true) {
            data = me.getDataFromStore(data);
        }
        // console.log(data);
        me.initialDataCount = data.length;
        me.insertingInitialData = true;

        Ext.each(data, function (entry) {
            Ext.create(model,entry).save();
        })
    },

    /**
     * Get data from store. Usually from Server proxy.
     * Useful if caching data data that don't change much (e.g. for comboboxes)
     * Used at {@link #addData}
     * @private
     * @param {Ext.data.Store} store Store instance
     * @return {Array} Array of raw data
     */
    getDataFromStore: function (store) {

        var data = [];
        store.each(function (item) {
            data.push(item.data)
        });
        return data;
    },
    //inherit docs
    create: function (operation, callback, scope) {
        var records = operation.getRecords(),
            length = records.length,
            id, record, i;
        operation.setStarted();
        
        for (i = 0; i < length; i++) {
            record = records[i];
            this.setRecord(record);
        }

        operation.setCompleted();
        operation.setSuccessful();

        if (typeof callback == 'function') {
            callback.call(scope || this, operation);
        }
    },

    //inherit docs
    read: function (operation, callback, scope) {

        var records = [],
            me = this;

        var finishReading = function (record) {
                me.readCallback(operation, record);
                if (typeof callback == 'function') {
                    callback.call(scope || this, operation);
                }
            }
console.log(operation);
            //read a single record
        if (operation.id) {
            this.getRecord(operation.id, finishReading, me);
        } else {
            this.getAllRecords(finishReading, me);
            operation.setSuccessful();
        }
    },

    /**
     * Injects data in operation instance
     */
    readCallback: function (operation, records) {
console.log(operation);
console.log(records);
        var rec = Ext.isArray(records) ? records : [records];
        operation.setSuccessful();
        operation.setCompleted();
        /*
        operation.resultSet = Ext.create('Ext.data.ResultSet', {
            records: rec,
            total  : rec.length,
            loaded : true
        });*/

        operation.resultSet = new Ext.data.ResultSet({
            records: rec,
            total: rec.length,
            loaded: true
        });
    },

    //inherit docs
    update: function (operation, callback, scope) {
        var records = operation.getRecords(),
            length = records.length,
            record, id, i;
        operation.setStarted();

        for (i = 0; i < length; i++) {
            record = records[i];
            this.updateRecord(record);
        }
        operation.setCompleted();
        operation.setSuccessful();

        if (typeof callback == 'function') {
            callback.call(scope || this, operation);
        }
    },

    //inherit
    destroy: function (operation, callback, scope) {

        var records = operation.getRecords(),
            length = records.length,
            i;

        for (i = 0; i < length; i++) {
            Ext.Array.remove(newIds, records[i].getId());
            this.removeRecord(records[i], false);
        }

        //this.setIds(newIds);
        operation.setCompleted();
        operation.setSuccessful();

        if (typeof callback == 'function') {
            callback.call(scope || this, operation);
        }
    },

    /**
     * @private
     * Created array of objects, each representing field=>value pair.
     * @param {Object} tx Transaction
     * @param {Object} rs Response
     * @return {Array} Returns parsed data
     */
    parseData: function (tx, rs) {

        var rows = rs.rows,
            data = [],
            i = 0;
        for (; i < rows.length; i++) {
            data.push(rows.item(i));
        }

        return data;
    },

    /**
     * @private
     * Fetches a single record by id.
     * @param {Mixed} id Record id
     * @param {Function} callback Callback function
     * @param {Object} scope Callback fn scope
     */
    getRecord: function (id, callback, scope) {

        var me = this,
            Model = this.getModel(),
            record, onSuccess = function (tx, rs) {
                var result = me.parseData(tx, rs);
                record = new Model(result, id);
                if (typeof callback == 'function') {
                    callback.call(scope || me, result, me);
                }
            }

        me.db.transaction(function (tx) {
            tx.executeSql('SELECT * FROM ' + me.getDbTable() + ' where ' + me.getPkField() + ' = ?', [id], onSuccess, //on success
            Ext.bind(me.onError, me)); // on error
        });

        return true;
    },



    /**
     * @private
     * Fetches all records
     * @param {Function} callback Callback function
     * @param {Object} scope Callback fn scope
     */
    getAllRecords: function (callback, scope) {

        var me = this,
            Model = me.getModel(),
            record, onSuccess = function (tx, rs) {
                var records = me.parseData(tx, rs),
                    results = [],
                    i = 0,
                    id;
                    console.log(rs);
                for (; i < records.length; i++) {
                    id = records[i][me.getPkField()];
                    results.push(new Model(records[i], id));
                }

                if (typeof callback == 'function') {
                    callback.call(scope || me, results, me);
                }
            }

        me.db.transaction(function (tx) {
            tx.executeSql('SELECT * FROM ' + me.getDbTable(), [], onSuccess, //on success
            Ext.bind(me.onError, me)); // on error
        });

        return true;
    },

    /**
     * Saves the given record in the Proxy.
     * @param {Ext.data.Model} record The model instance
     */
    setRecord: function (record) {
        console.log(record);
        var me = this,
            rawData = record.data,
            fields = [],
            values = [],
            placeholders = [],
            onSuccess = function (tx, rs) {
                if (me.insertingInitialData) {
                    me.initialDataCount--;
                    if (me.initialDataCount === 0) {
                        me.insertingInitialData = false;
                        me.fireEvent('initialDataInserted');
                    }
                }
            };
        //extract data to be inserted
        for (var i in rawData) {
            fields.push('"' + i + '"');
            var value = rawData[i];
            if(value == null){
                value = '';
            }
            if(Ext.typeOf(value) == 'date'){
                value = Ext.Date.format(value,'Y-m-d H:i:s');
            }
            console.log(value);
            values.push(value);
            placeholders.push('?');
        }
        me.db.transaction(function (tx) {
            tx.executeSql('INSERT INTO ' + me.getDbTable() + '(' + fields.join(',') + ') VALUES (' + placeholders.join(',') + ')', values, onSuccess, //on success
            Ext.bind(me.onError, me)); // on error
        });

        return true;
    },

    /**
     * Updates the given record.
     * @param {Ext.data.Model} record The model instance
     */
    updateRecord: function (record) {

        var me = this,
            id = record.internalId || record[me.getPkField()],
            key = me.getReader().idProperty,
            modifiedData = record.modified,
            newData = record.data,
            pairs = [],
            values = [],
            onSuccess = function (tx, rs) {
                //add new record if id doesn't exist
                if (!rs.rowsAffected) me.setRecord(record);
            };


        /*for (var i in modifiedData) {
              pairs.push('"'+i+'" = ?');
              values.push(newData[i]);
          }*/
        var fields = Object.keys(record.data);
        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            if (key == field) {
                // Don't want to update primary key
                continue;
            }
            pairs.push(field + ' = ?');
            values.push(record.data[field]);
        }
        values.push(id);

        me.db.transaction(function (tx) {
            tx.executeSql('UPDATE ' + me.getDbTable() + ' SET ' + pairs.join(',') + ' WHERE ' + key + ' = ?', values, onSuccess, //on success
            Ext.bind(me.setRecord, me, [record])); // on error
        });

        return true;
    },

    /**
     * @private
     * Physically removes a given record from the object store. 
     * @param {Mixed} id The id of the record to remove
     */
    removeRecord: function (record) {

        var me = this;
        var id = record.internalId || record[me.getPkField()] || record.data[me.getPkField()];

        me.db.transaction(function (tx) {
            tx.executeSql('DELETE FROM ' + me.getDbTable() + ' WHERE ' + me.getPkField() + ' = ?', [id], Ext.emptyFn, //on success
            Ext.bind(me.onError, me)); // on error
        });

        return true;

    },

    /**
     * Destroys all records stored in the proxy 
     */
    clear: function (callback, scope) {

        var me = this;

        me.db.transaction(function (tx) {
            tx.executeSql('DELETE FROM ' + me.getDbTable(), [], Ext.emptyFn, //on success
            Ext.bind(me.onError, me)); // on error
        });

        return true;
    },

    registerExtJsFx: function () {
        Ext.apply(Ext, {
            bind: function (fn, scope, args, appendArgs) {
                var method = fn,
                    slice = Array.prototype.slice;

                return function () {
                    var callArgs = args || arguments;

                    if (appendArgs === true) {
                        callArgs = slice.call(arguments, 0);
                        callArgs = callArgs.concat(args);
                    } else if (Ext.isNumber(appendArgs)) {
                        callArgs = slice.call(arguments, 0); // copy arguments first
                        Ext.Array.insert(callArgs, appendArgs, args);
                    }

                    return method.apply(scope || window, callArgs);
                };
            }
        });

        Ext.apply(Ext, {
            isString: function (value) {
                return typeof value === 'string';
            }
        });

    }

});

// Ext.data.ProxyMgr.registerType('websql', Ext.data.WebSqlProxy);