class RoomsImagesExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options) {
    super(viewer, options);
    this._onObjectTreeCreated = (ev) => this.onModelLoaded(ev.model);
    this.viewObjs = null;
    this.roomElements = [];
  }

  async onModelLoaded(model) {
    this.doorData = await this.getDoorData();
  }

  async generateRoomsThumbnails() {
    console.log('camera is no longer moving');
    if (!!this.viewObjs) {
      let viewObj = this.viewObjs.pop();
      this.generateThumbnail(viewObj);
    }
  }

  async getRoomsCameraArrays() {
    this.viewObjs = [];
    const roomsData = await this.getRoomData();
    //Here we set the height in meters, so if the model is set in ft, we need a multiplier
    let unitsMultiplier = 1;
    let eyeHeight = 1.7;
    switch (this.viewer.model.getUnitString()) {
      case 'ft':
        unitsMultiplier = 3.28084;
      default:
        break;
    }
    for (const room of roomsData) {
      try {
        let roombbox = await this.getBoundingBox(room.dbId);
        let roomDoors = this.doorData.filter(door => door.bbox.intersectsBox(roombbox));
        let newViewObj = {};
        newViewObj.name = room.name;
        newViewObj.dbId = room.dbId;
        newViewObj.target = roombbox.getCenter();
        let auxposition;
        if (roomDoors.length > 0) {
          const doorCenter = roomDoors[0].getCenter();
          let auxDirection = newViewObj.target.clone().sub(doorCenter).normalize();
          auxposition = doorCenter.add(auxDirection.multiplyScalar(1 * unitsMultiplier));
        }
        else {
          auxposition = roombbox.max.clone().add(newViewObj.target.clone()).multiplyScalar(0.5);
        }
        auxposition.z = roombbox.min.z + unitsMultiplier * eyeHeight;
        newViewObj.position = auxposition;
        this.viewObjs.push(newViewObj);
      }
      catch (error) {
        console.log('Error with room', room.name);
      }
    }
  }

  onToolbarCreated(toolbar) {
    this._button = this.createToolbarButton('roomsthumbnails-button', 'https://img.icons8.com/ios/30/camera--v3.png', 'Rooms Screenshots');
    this._button.onClick = async () => {
      this.roomElements = [];
      await this.getRoomsCameraArrays();
      this.viewer.navigation.toPerspective();
      await this.generateRoomsThumbnails();
    };
  }

  createToolbarButton(buttonId, buttonIconUrl, buttonTooltip) {
    let group = this.viewer.toolbar.getControl('rooms-toolbar-group');
    if (!group) {
      group = new Autodesk.Viewing.UI.ControlGroup('rooms-toolbar-group');
      this.viewer.toolbar.addControl(group);
    }
    const button = new Autodesk.Viewing.UI.Button(buttonId);
    button.setToolTip(buttonTooltip);
    group.addControl(button);
    const icon = button.container.querySelector('.adsk-button-icon');
    if (icon) {
      icon.style.backgroundImage = `url(${buttonIconUrl})`;
      icon.style.backgroundSize = `24px`;
      icon.style.backgroundRepeat = `no-repeat`;
      icon.style.backgroundPosition = `center`;
    }
    return button;
  }

  removeToolbarButton(button) {
    const group = this.viewer.toolbar.getControl('rooms-toolbar-group');
    group.removeControl(button);
  }

  async getRoomData() {
    const getRoomDbIds = () => {
      return new Promise((resolve, reject) => {
        this.viewer.search(
          'Revit Rooms',
          (dbIds) => resolve(dbIds),
          (error) => reject(error),
          ['Category'],
          { searchHidden: true }
        );
      });
    };

    const getPropertiesAsync = (dbId) => {
      return new Promise((resolve, reject) => {
        this.viewer.getProperties(
          dbId,
          (result) => resolve(result),
          (error) => reject(error),
        );
      });
    }

    const data = [];

    try {
      const roomDbIds = await getRoomDbIds();
      if (!roomDbIds || roomDbIds.length <= 0) {
        throw new Error('No Rooms found in current model');
      }

      for (let i = 0; i < roomDbIds.length; i++) {
        const dbId = roomDbIds[i];
        const propData = await getPropertiesAsync(dbId);

        data.push({
          id: propData.externalId,
          dbId: dbId,
          name: propData.name
        });
      }

    } catch (ex) {
      console.warn(`[RoomListPanel]: ${ex}`);
      throw new Error('Failed to extract room data');
    }

    return data;
  }

  async getDoorData() {
    const getDoorDbIds = () => {
      return new Promise((resolve, reject) => {
        this.viewer.search(
          'Doors',
          (dbIds) => resolve(dbIds),
          (error) => reject(error),
          ['Category'],
          { searchHidden: true }
        );
      });
    };

    const getPropertiesAsync = (dbId) => {
      return new Promise((resolve, reject) => {
        this.viewer.getProperties(
          dbId,
          (result) => resolve(result),
          (error) => reject(error),
        );
      });
    }

    const data = [];

    try {
      const doorDbIds = await getDoorDbIds();
      if (!doorDbIds || doorDbIds.length <= 0) {
        throw new Error('No Rooms found in current model');
      }

      for (let i = 0; i < doorDbIds.length; i++) {
        const dbId = doorDbIds[i];
        const propData = await getPropertiesAsync(dbId);
        let bbox = await this.getBoundingBox(dbId);

        data.push({
          id: propData.externalId,
          dbId: dbId,
          name: propData.name,
          bbox: bbox
        });
      }

    } catch (ex) {
      console.warn(`[DoorListPanel]: ${ex}`);
      throw new Error('Failed to extract door data');
    }

    return data;
  }

  async getBoundingBox(dbId) {
    const model = this.viewer.model;
    const it = model.getInstanceTree();
    const fragList = model.getFragmentList();
    let bounds = new THREE.Box3();

    it.enumNodeFragments(dbId, (fragId) => {
      let box = new THREE.Box3();
      fragList.getWorldBounds(fragId, box);
      bounds.union(box);
    }, true);

    return bounds;
  }

  async getViewElements() {
    const tool = this.viewer.getExtension('Autodesk.BoxSelection').boxSelectionTool;
    const { left: startX, top: startY, right: endX, bottom: endY } = this.viewer.impl.getCanvasBoundingClientRect();
    tool.startPoint.set(startX, startY);
    tool.endPoint.set(endX, endY);
    let selection = await tool.getSelection();
    return selection;
  }

  async generateThumbnail(viewObj) {
    await this.viewer.navigation.setView(viewObj.position, viewObj.target);
    await this.viewer.navigation.setCameraUpVector(new THREE.Vector3(0, 0, 1));
    await this, viewer.setFocalLength(10);
    let dbIdsinView = await this.getViewElements();
    this.roomElements.push({
      name: viewObj.name,
      dbIdsinView: dbIdsinView[0].ids
    })
    //let vw = this.viewer.container.clientWidth;
    //let vh = this.viewer.container.clientHeight;
    //Values for AI model below
    let vw = 512;
    let vh = 512;
    this.viewer.getScreenShot(vw, vh, blob => {
      var image = new Image();
      image.src = blob;
      var tag = document.createElement('a');
      tag.href = blob;
      tag.download = `${viewObj.name}.png`;
      document.body.appendChild(tag);
      tag.click();
      document.body.removeChild(tag);
      let viewpointsCount = this.viewObjs.length;
      if (viewpointsCount > 0) {
        this.generateRoomsThumbnails.call(this)
      }
      else {
        let propsAAcquired = 0;
        for (const roomElement of this.roomElements) {
          this.viewer.model.getBulkProperties2(roomElement.dbIdsinView, { needsExternalId: false, ignoreHidden: true }, results => {
            roomElement.properties = results;
            propsAAcquired++;
            if (this.roomElements.length == propsAAcquired)
              this.downloadObjectAsJson(this.roomElements, 'RoomsElements');
          }, error => {
            console.log(error);
            if (this.roomElements.length == propsAAcquired)
              this.downloadObjectAsJson(this.roomElements, 'RoomsElements');
          });
        }
      }
    });
  }

  downloadObjectAsJson(exportObj, exportName) {
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    var downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", exportName + ".json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  async load() {
    console.log('Rooms Images Extension has been loaded.');
    this.viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, this._onObjectTreeCreated);
    return true;
  }

  unload() {
    if (this._button) {
      this.removeToolbarButton(this._button);
      this._button = null;
    }
    return true;
  }
}

Autodesk.Viewing.theExtensionManager.registerExtension('RoomsImagesExtension', RoomsImagesExtension);
