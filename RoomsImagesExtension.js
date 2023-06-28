class RoomsImagesExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options) {
    super(viewer, options);
    this._onObjectTreeCreated = (ev) => this.onModelLoaded(ev.model);
    this.viewObjs = null;
  }

  async onModelLoaded(model) {
    this.viewer.addEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, () => {
      this.generateRoomsThumbnails.call(this)
    });
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
    for (const room of roomsData) {
      try {
        let roombbox = await this.getBoundingBox(room.dbId);
        let newViewObj = {};
        newViewObj.target = roombbox.getCenter();
        newViewObj.position = roombbox.max.clone().add(newViewObj.target.clone()).multiplyScalar(0.5);
        newViewObj.name = room.name;
        newViewObj.dbId = room.dbId;
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

  async generateThumbnail(viewObj) {
    await this.viewer.navigation.setView(viewObj.position, viewObj.target);
    await this.viewer.navigation.setCameraUpVector(new THREE.Vector3(0, 0, 1));
    let vw = this.viewer.container.clientWidth;
    let vh = this.viewer.container.clientHeight;
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
        this.viewer.fitToView(viewObj.dbId);
      }
    });
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